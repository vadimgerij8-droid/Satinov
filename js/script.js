// ================= Firebase імпорти =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, OAuthProvider, signInWithPopup, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, arrayUnion, arrayRemove, deleteDoc, getDocs, increment, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

// ================= Конфігурація =================
const firebaseConfig = {
  apiKey: "AIzaSyDRzC-QDE0-UXd-XL0i3iqayFiKcc6wmvc",
  authDomain: "fantasyasapp.firebaseapp.com",
  projectId: "fantasyasapp",
  storageBucket: "fantasyasapp.appspot.com",
  messagingSenderId: "721763921060",
  appId: "1:721763921060:web:3d61044ea2424e8176ca31"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ================= Глобальні змінні =================
let currentUser = null;
let currentUserFollowing = [];
let currentChatPartner = null;
let currentChatPartnerName = '';
let currentChatId = null;
let currentProfileUid = null;
let currentEditingPost = null;

let unsubscribeFeed = null;
let unsubscribeChat = null;
let unsubscribeChatList = null;
let unsubscribeTyping = null;
let unsubscribeOnlineStatus = null;
let unsubscribeFollowing = null;
let lastOnlineInterval = null;

let unreadCount = 0;
let currentFeedType = 'new';
let lastVisible = null;
let loading = false;
let hasMore = true;

const viewedPosts = new Set();

// TV налаштування – за замовчуванням увімкнено
const tvSettings = {
  tvNavEnabled: localStorage.getItem('tvNav') !== 'false',
  remoteNavEnabled: localStorage.getItem('remoteNav') !== 'false',
  focusOptimized: localStorage.getItem('focusOptimized') !== 'false',
  tvCursorEnabled: localStorage.getItem('tvCursor') === 'true',
  vibrateOnFocus: localStorage.getItem('vibrateOnFocus') !== 'false'
};

// ================= НОВА СИСТЕМА НАВІГАЦІЇ (spatial navigation з покращеннями) =================
const TVNavigation = (() => {
  // Приватні змінні
  let focusableElements = [];
  let lastFocusedElement = null;
  let lastFocusedElementBeforeModal = null;
  let updatePending = false;
  let domObserver = null;
  let keyDebounceTimer = null;
  let keyRepeatTimer = null;
  let currentDirection = null;
  let repeatCount = 0;

  // CSS стилі для фокусу
  const injectStyles = () => {
    if (document.getElementById('tv-nav-styles')) return;
    const style = document.createElement('style');
    style.id = 'tv-nav-styles';
    style.textContent = `
      .focused {
        transform: scale(1.02);
        box-shadow: 0 0 15px #0078ff, 0 0 30px rgba(0,120,255,0.5);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        outline: none !important;
        z-index: 100;
      }
      /* Для елементів, які не повинні змінювати масштаб (наприклад, аватарки) */
      .avatar.focused, .emoji-button.focused {
        transform: scale(1.05);
      }
    `;
    document.head.appendChild(style);
  };

  // Отримання всіх видимих фокусованих елементів
  const getFocusableElements = () => {
    const activeModal = document.querySelector('.modal.active');
    let container = activeModal || document;

    const baseSelector = `
      button, input, textarea, select, a[href], 
      [tabindex]:not([tabindex="-1"]), 
      .nav-item, .post, .chat-item, .profile-tab, 
      .hashtag-item, .modal-close, .emoji-button, 
      .btn, .file-input-button, .post-actions button,
      .comment-author, .post-author, .avatar, .hashtag,
      .follow-btn-post, .profile-menu-btn, .profile-menu-item,
      [role="button"], [role="link"], [role="menuitem"]
    `;

    const elements = Array.from(container.querySelectorAll(baseSelector));
    
    return elements.filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             el.offsetParent !== null && 
             !el.disabled &&
             !el.hasAttribute('aria-hidden') &&
             el.getAttribute('aria-hidden') !== 'true';
    });
  };

  // Оновлення кешу елементів
  const updateCache = () => {
    focusableElements = getFocusableElements();
    updatePending = false;
  };

  // Запит на оновлення (з requestAnimationFrame)
  const requestUpdate = () => {
    if (!updatePending) {
      updatePending = true;
      requestAnimationFrame(updateCache);
    }
  };

  // Отримання центру елемента
  const getCenter = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  };

  // Пошук найближчого елемента в заданому напрямку
  const findClosestElement = (currentEl, direction) => {
    if (!currentEl || focusableElements.length === 0) return null;

    const currentCenter = getCenter(currentEl);
    const candidates = focusableElements.filter(el => el !== currentEl);
    if (candidates.length === 0) return null;

    const dirMap = {
      'ArrowUp': { dx: 0, dy: -1 },
      'ArrowDown': { dx: 0, dy: 1 },
      'ArrowLeft': { dx: -1, dy: 0 },
      'ArrowRight': { dx: 1, dy: 0 }
    };
    const dir = dirMap[direction];
    if (!dir) return null;

    let best = null;
    let bestScore = Infinity;

    candidates.forEach(candidate => {
      const candidateCenter = getCenter(candidate);
      const dx = candidateCenter.x - currentCenter.x;
      const dy = candidateCenter.y - currentCenter.y;

      // Перевіряємо, чи елемент знаходиться в потрібному напрямку (скалярний добуток > 0)
      const dot = dx * dir.dx + dy * dir.dy;
      if (dot <= 0) return;

      // Відстань
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Кут між напрямком і вектором до кандидата (чим менше, тим краще)
      const cosAngle = dot / distance;
      
      // Відхилення по перпендикуляру (чим менше, тим краще)
      let perpendicularDistance;
      if (dir.dx !== 0) {
        perpendicularDistance = Math.abs(dy);
      } else {
        perpendicularDistance = Math.abs(dx);
      }

      // Зважена оцінка: відстань / cosAngle + перпендикуляр * коефіцієнт
      let score = distance / cosAngle + perpendicularDistance * 2;

      // Покращення для повторного натискання: зменшуємо оцінку, якщо повторюємо напрямок
      if (direction === currentDirection) {
        score /= (1 + repeatCount * 0.2); // робимо дальші елементи привабливішими при утриманні
      }

      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    });

    return best;
  };

  // Встановлення фокусу на елемент
  const setFocus = (el) => {
    if (!el) return;

    // Видаляємо клас з усіх елементів
    document.querySelectorAll('.focused').forEach(e => e.classList.remove('focused'));

    // Додаємо клас і встановлюємо фокус
    el.classList.add('focused');
    
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
      el.focus();
    } else {
      el.focus({ preventScroll: true });
    }

    // Плавний скрол до елемента з покращенням (центруємо)
    const rect = el.getBoundingClientRect();
    const container = el.closest('.content') || document.documentElement;
    const containerRect = container.getBoundingClientRect();
    const offset = rect.top - containerRect.top - (containerRect.height / 2 - rect.height / 2);
    container.scrollBy({ top: offset, behavior: 'smooth' });

    lastFocusedElement = el;

    // Оновлення TV-курсора, якщо ввімкнено
    if (tvSettings.tvCursorEnabled) {
      updateTVCursor(el);
    }

    // Вібрація, якщо ввімкнено
    if (tvSettings.vibrateOnFocus && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  // Встановлення фокусу на перший елемент у контейнері
  const focusFirstInContainer = (container) => {
    const focusable = Array.from(container.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(el => el.offsetParent !== null && !el.disabled);
    if (focusable.length > 0) {
      setFocus(focusable[0]);
      return true;
    }
    return false;
  };

  // Перевірка та відновлення фокусу (якщо поточний невалідний)
  const ensureFocus = () => {
    requestUpdate();
    // Даємо час на оновлення кешу
    setTimeout(() => {
      const focused = document.querySelector('.focused');
      if (focused && focusableElements.includes(focused)) {
        return; // фокус валідний
      }
      const first = focusableElements[0];
      if (first) setFocus(first);
    }, 50);
  };

  // Фокус на перший елемент після завантаження розділу
  const focusFirstElementAfterLoad = () => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        ensureFocus();
      });
    }, 100);
  };

  // Оновлення позиції TV-курсора
  const updateTVCursor = (focusedEl) => {
    const cursor = document.getElementById('tvCursor');
    if (!cursor) return;
    if (!tvSettings.tvCursorEnabled || !focusedEl) {
      cursor.style.display = 'none';
      return;
    }
    const rect = focusedEl.getBoundingClientRect();
    cursor.style.display = 'block';
    cursor.style.left = (rect.left - 20) + 'px';
    cursor.style.top = (rect.top + rect.height/2 - 16) + 'px';
  };

  // Закриття всіх поп-апів (емодзі, меню)
  const closeAllPopups = () => {
    document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.profile-menu-dropdown.show').forEach(d => d.classList.remove('show'));
  };

  // Обробник натискання клавіш
  const handleKeyDown = (e) => {
    if (!tvSettings.tvNavEnabled && !tvSettings.remoteNavEnabled) return;

    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const isArrow = arrowKeys.includes(e.key);
    const isEnter = e.key === 'Enter';
    const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.code === 'Escape';

    if (!isArrow && !isEnter && !isBack) return;

    e.preventDefault();

    // Оновлюємо кеш перед обробкою
    requestUpdate();

    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

    // ===== BACK / EXIT =====
    if (isBack) {
      // Якщо активне поле введення – не обробляємо (користувач хоче вийти з поля)
      if (isInput) return;

      const openEmojiPicker = document.querySelector('.emoji-picker[style*="display: grid"]');
      if (openEmojiPicker) {
        openEmojiPicker.style.display = 'none';
        if (lastFocusedElement && lastFocusedElement.classList.contains('emoji-button')) {
          setFocus(lastFocusedElement);
        } else {
          ensureFocus();
        }
        return;
      }

      const openDropdown = document.querySelector('.profile-menu-dropdown.show');
      if (openDropdown) {
        openDropdown.classList.remove('show');
        const menuBtn = document.querySelector('.profile-menu-btn');
        if (menuBtn) setFocus(menuBtn);
        return;
      }

      const activeModals = document.querySelectorAll('.modal.active');
      if (activeModals.length > 0) {
        activeModals.forEach(modal => modal.classList.remove('active'));
        setTimeout(() => {
          requestUpdate();
          if (lastFocusedElementBeforeModal && focusableElements.includes(lastFocusedElementBeforeModal)) {
            setFocus(lastFocusedElementBeforeModal);
            lastFocusedElementBeforeModal = null;
          } else if (lastFocusedElement && !lastFocusedElement.closest('.modal')) {
            setFocus(lastFocusedElement);
          } else {
            ensureFocus();
          }
        }, 50);
        return;
      }

      const chatWindow = document.getElementById('chatWindow');
      if (chatWindow && chatWindow.style.display === 'flex') {
        chatWindow.style.display = 'none';
        setTimeout(() => {
          requestUpdate();
          const firstChat = document.querySelector('.chat-item');
          if (firstChat) setFocus(firstChat);
        }, 50);
        return;
      }

      const activeSection = document.querySelector('.section.active');
      if (activeSection && activeSection.id !== 'home') {
        document.querySelector('[data-section="home"]').click();
      }
      return;
    }

    // ===== ENTER / OK =====
    if (isEnter) {
      if (isInput) return;

      const focused = document.querySelector('.focused') || activeEl;
      if (focused) {
        // Запам'ятовуємо елемент перед кліком, якщо він може відкрити модалку
        if (focused.closest('[data-modal]') || focused.classList.contains('open-modal')) {
          lastFocusedElementBeforeModal = focused;
        }
        focused.click();
        if (tvSettings.vibrateOnFocus && navigator.vibrate) {
          navigator.vibrate(20);
        }
      } else {
        ensureFocus();
      }
      return;
    }

    // ===== СТРІЛКИ =====
    if (isArrow) {
      if (isInput) return;

      let current = document.querySelector('.focused') || activeEl;

      if (!current) {
        ensureFocus();
        return;
      }

      // Спеціальна обробка для сітки емодзі
      const emojiPicker = current.closest('.emoji-picker');
      if (emojiPicker && emojiPicker.style.display === 'grid') {
        const emojiButtons = Array.from(emojiPicker.querySelectorAll('button'));
        const currentIndex = emojiButtons.indexOf(current);
        if (currentIndex !== -1) {
          let nextIndex;
          const cols = 8; // фіксована кількість колонок
          if (e.key === 'ArrowRight') nextIndex = currentIndex + 1;
          else if (e.key === 'ArrowLeft') nextIndex = currentIndex - 1;
          else if (e.key === 'ArrowDown') nextIndex = currentIndex + cols;
          else if (e.key === 'ArrowUp') nextIndex = currentIndex - cols;

          if (nextIndex >= 0 && nextIndex < emojiButtons.length) {
            setFocus(emojiButtons[nextIndex]);
          }
          return;
        }
      }

      // Загальний випадок – пошук найближчого
      const next = findClosestElement(current, e.key);
      if (next) setFocus(next);

      // Підтримка утримання клавіші
      currentDirection = e.key;
      repeatCount++;
      clearTimeout(keyRepeatTimer);
      keyRepeatTimer = setTimeout(() => {
        handleKeyDown(e); // Рекурсивний виклик для repeat
      }, repeatCount > 1 ? 100 : 300); // Швидше після першого repeat
    }
  };

  // Обробник відпускання клавіші
  const handleKeyUp = (e) => {
    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (arrowKeys.includes(e.key)) {
      currentDirection = null;
      repeatCount = 0;
      clearTimeout(keyRepeatTimer);
    }
  };

  // Ініціалізація
  const init = () => {
    injectStyles();

    // Спостерігач за змінами DOM
    domObserver = new MutationObserver(() => {
      requestUpdate();
    });
    domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    // Оновлення при скролі
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        requestUpdate();
      }, 150);
    }, { passive: true });

    // Обробники клавіш
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Початкове оновлення та фокус
    window.addEventListener('load', () => {
      setTimeout(() => {
        requestUpdate();
        ensureFocus();
      }, 500);
    });
  };

  // Публічний API
  return {
    init,
    requestUpdate,
    setFocus,
    ensureFocus,
    focusFirstInContainer,
    focusFirstElementAfterLoad,
    getFocusableElements: () => focusableElements,
    setLastFocusedBeforeModal: (el) => { lastFocusedElementBeforeModal = el; },
    clearLastFocusedBeforeModal: () => { lastFocusedElementBeforeModal = null; }
  };
})();

// Ініціалізація навігації
function initTVNavigation() {
  TVNavigation.init();
}

// Глобальні функції-обгортки для сумісності з існуючим кодом
const setFocusOnElement = (el) => TVNavigation.setFocus(el);
const ensureFocus = () => TVNavigation.ensureFocus();
const updateFocusableCache = () => TVNavigation.requestUpdate();
const requestFocusUpdate = () => TVNavigation.requestUpdate();
const focusFirstInContainer = (container) => TVNavigation.focusFirstInContainer(container);
const focusFirstElementAfterLoad = () => TVNavigation.focusFirstElementAfterLoad();

// Викликаємо ініціалізацію
initTVNavigation();

// Функція для оновлення TV-курсора (використовується в setFocus)
function updateTVCursor(focusedEl) {
  const cursor = document.getElementById('tvCursor');
  if (!cursor) return;
  if (!tvSettings.tvCursorEnabled || !focusedEl) {
    cursor.style.display = 'none';
    return;
  }
  const rect = focusedEl.getBoundingClientRect();
  cursor.style.display = 'block';
  cursor.style.left = (rect.left - 20) + 'px';
  cursor.style.top = (rect.top + rect.height/2 - 16) + 'px';
}

// ================= Допоміжні функції =================
const showToast = (msg) => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
};

const vibrate = (ms) => { if (navigator.vibrate) navigator.vibrate(ms); };

const updateUnreadBadge = () => {
  const badge = document.getElementById('unreadBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
};

const cleanupListeners = () => {
  if (unsubscribeFeed) { unsubscribeFeed(); unsubscribeFeed = null; }
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribeChatList) { unsubscribeChatList(); unsubscribeChatList = null; }
  if (unsubscribeTyping) { unsubscribeTyping(); unsubscribeTyping = null; }
  if (unsubscribeOnlineStatus) { unsubscribeOnlineStatus(); unsubscribeOnlineStatus = null; }
  if (unsubscribeFollowing) { unsubscribeFollowing(); unsubscribeFollowing = null; }
  if (lastOnlineInterval) { clearInterval(lastOnlineInterval); lastOnlineInterval = null; }
};

// ================= Функції для скарг, мюту, блокування =================
async function reportUser(targetUid, reason = '') {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "reports"), {
      reportedUserId: targetUid,
      reporterId: currentUser.uid,
      reason: reason || 'Без причини',
      timestamp: serverTimestamp()
    });
    showToast('Скаргу надіслано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function muteUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      mutedUsers: arrayUnion(targetUid)
    });
    showToast('Користувача замучено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function unmuteUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      mutedUsers: arrayRemove(targetUid)
    });
    showToast('Користувача розмучено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function blockUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      blockedUsers: arrayUnion(targetUid)
    });
    showToast('Користувача заблоковано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function unblockUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      blockedUsers: arrayRemove(targetUid)
    });
    showToast('Користувача розблоковано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

// ================= Навігація по розділах =================
const sections = ['home','search','hashtags','profile','chats','settings'];
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach((item) => {
  item.addEventListener('click', async () => {
    const section = item.dataset.section;
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    sections.forEach(s => document.getElementById(s).classList.remove('active'));
    const sectionEl = document.getElementById(section);
    if (sectionEl) sectionEl.classList.add('active');
    document.getElementById('pageTitle').textContent = item.textContent.trim();
    
    cleanupListeners();
    
    if (section === 'home' && currentUser) {
      resetPagination();
    }
    if (section === 'search' && currentUser) {
      await loadSearchUsers();
    }
    if (section === 'hashtags' && currentUser) {
      await loadHashtags();
    }
    if (section === 'chats' && currentUser) {
      document.getElementById('chatWindow').style.display = 'none';
      await loadChatList();
      document.getElementById('chatSearchResults').style.display = 'none';
      document.getElementById('chatSearchInput').value = '';
    }
    if (section === 'profile' && currentUser) {
      await viewProfile(currentUser.uid);
    }
    if (section === 'settings') {
      // нічого не завантажуємо
    }
    
    closeSidebar();
    // Після зміни розділу встановлюємо фокус на перший елемент
    focusFirstElementAfterLoad();
  });
});

const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const backdrop = document.getElementById('sidebarBackdrop');

function openSidebar() {
  sidebar.classList.add('open');
  menuToggle.classList.add('active');
  backdrop.classList.add('active');
  focusFirstInContainer(sidebar);
}

function closeSidebar() {
  sidebar.classList.remove('open');
  menuToggle.classList.remove('active');
  backdrop.classList.remove('active');
  setTimeout(() => {
    requestFocusUpdate();
    setFocusOnElement(menuToggle);
  }, 50);
}

menuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  if (sidebar.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

backdrop.addEventListener('click', closeSidebar);

// ================= Емоджі-пікер =================
const emojiList = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];

function closeAllEmojiPickers() {
  document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
}

function setupEmojiPicker(buttonId, pickerId, inputId) {
  const btn = document.getElementById(buttonId);
  const picker = document.getElementById(pickerId);
  const input = document.getElementById(inputId);
  if (!btn || !picker || !input) return;
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllEmojiPickers();
    
    const rect = btn.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    picker.style.bottom = spaceAbove > 280 ? '100%' : 'auto';
    picker.style.top = spaceBelow > 280 ? 'auto' : '100%';
    picker.style.left = 'auto';
    picker.style.right = '0';
    
    picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    if (picker.style.display === 'grid') {
      setTimeout(() => { 
        requestFocusUpdate(); 
        const firstEmoji = picker.querySelector('button');
        if (firstEmoji) setFocusOnElement(firstEmoji);
      }, 50);
    }
  });
  
  picker.innerHTML = '';
  emojiList.forEach(emoji => {
    const button = document.createElement('button');
    button.textContent = emoji;
    button.type = 'button';
    button.tabIndex = 0;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const text = input.value;
      input.value = text.substring(0, start) + emoji + text.substring(end);
      input.focus();
      input.selectionStart = input.selectionEnd = start + emoji.length;
      picker.style.display = 'none';
      requestFocusUpdate();
      setFocusOnElement(input);
    });
    picker.appendChild(button);
  });
  
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== btn) {
      picker.style.display = 'none';
    }
  });
}

// ================= Кастомний вибір файлу =================
function setupFileInput(inputId, labelId, previewId) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  const preview = document.getElementById(previewId);
  if (!input || !label) return;

  input.addEventListener('change', function() {
    if (this.files && this.files[0]) {
      const file = this.files[0];
      label.textContent = file.name.length > 30 ? file.name.substring(0,30)+'…' : file.name;
      
      if (preview) {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            preview.src = e.target.result;
            preview.classList.add('show');
          };
          reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
          preview.src = '';
          preview.classList.remove('show');
        }
      }
    } else {
      label.textContent = inputId.includes('Avatar') ? 'Обрати аватар' : 'Обрати фото/відео';
      if (preview) preview.classList.remove('show');
    }
  });
}

// ================= Функції для хештегів =================
function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

async function loadHashtags() {
  const list = document.getElementById('hashtagList');
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    const postsSnap = await getDocs(collection(db, "posts"));
    const tagCount = new Map();
    postsSnap.forEach(doc => {
      const tags = doc.data().hashtags || [];
      tags.forEach(tag => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });

    const sortedTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    
    list.innerHTML = '';
    if (sortedTags.length === 0) {
      list.innerHTML = '<p style="text-align:center; padding:20px;">Поки немає хештегів</p>';
      return;
    }

    sortedTags.forEach(([tag, count]) => {
      const div = document.createElement('div');
      div.className = 'hashtag-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <span class="hashtag-name">${tag}</span>
        <span class="hashtag-count">${count} постів</span>
      `;
      div.onclick = () => searchHashtag(tag);
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error loading hashtags:', e);
    list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
  requestFocusUpdate();
}

function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    document.querySelector('[data-section="search"]').click();
    loadSearchUsers();
  }
}

// ================= АВТОРИЗАЦІЯ =================
document.getElementById('toRegister').onclick = () => {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  setTimeout(() => { requestFocusUpdate(); setFocusOnElement(document.getElementById('registerNickname')); }, 50);
};
document.getElementById('toLogin').onclick = () => {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  setTimeout(() => { requestFocusUpdate(); setFocusOnElement(document.getElementById('loginNickname')); }, 50);
};

document.getElementById('registerBtn').onclick = async () => {
  const nickname = document.getElementById('registerNickname').value.trim();
  const password = document.getElementById('registerPassword').value.trim();
  if (!nickname) return alert('Введіть псевдонім');
  if (password.length < 6) return alert('Мінімум 6 символів');
  
  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (!snap.empty) return alert('Цей ID вже зайнятий');
  
  try {
    const safeNick = nickname.toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = Math.floor(Math.random() * 10000);
    const email = `${safeNick}_${randomSuffix}@fantasyas.local`;
    
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    
    await setDoc(doc(db, "users", cred.user.uid), {
      nickname,
      userId,
      nickname_lower: nickname.toLowerCase(),
      bio: '',
      avatar: '',
      posts: [],
      likedPosts: [],
      savedPosts: [],
      followers: [],
      following: [],
      mutedUsers: [],
      blockedUsers: [],
      createdAt: serverTimestamp(),
      lastOnline: serverTimestamp(),
      email: email
    });
    
    showToast('Реєстрація успішна');
    document.getElementById('toLogin').click();
  } catch (e) { showToast(e.message); }
};

document.getElementById('loginBtn').onclick = async () => {
  const nickname = document.getElementById('loginNickname').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (!nickname || !password) return alert('Заповніть поля');
  try {
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) return alert('Користувача не знайдено');
    
    const userDoc = snap.docs[0];
    const userData = userDoc.data();
    const email = userData.email;
    
    if (!email) {
      return alert('Для цього акаунту не встановлено email. Увійдіть через Google або Apple, або створіть новий акаунт.');
    }
    
    await signInWithEmailAndPassword(auth, email, password);
    showToast('Ласкаво просимо!');
  } catch (err) {
    alert('Невірний псевдонім або пароль');
  }
};

// Google Login
document.getElementById('googleLoginBtn').onclick = async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      const nickname = user.displayName || user.email?.split('@')[0] || 'user';
      let userId = `@${nickname.toLowerCase()}`;
      const q = query(collection(db, "users"), where("userId", "==", userId));
      const snap = await getDocs(q);
      if (!snap.empty) userId = `@${nickname.toLowerCase()}${Math.floor(Math.random()*1000)}`;
      await setDoc(doc(db, "users", user.uid), {
        nickname,
        userId,
        nickname_lower: nickname.toLowerCase(),
        bio: '',
        avatar: user.photoURL || '',
        posts: [],
        likedPosts: [],
        savedPosts: [],
        followers: [],
        following: [],
        mutedUsers: [],
        blockedUsers: [],
        createdAt: serverTimestamp(),
        lastOnline: serverTimestamp(),
        email: user.email
      });
    }
    showToast('Вхід через Google успішний');
  } catch (error) {
    console.error('Google login error:', error);
    if (error.code === 'auth/popup-blocked') {
      showToast('Будь ласка, дозвольте спливаючі вікна для цього сайту, щоб увійти через Google.');
    } else if (error.code === 'auth/operation-not-allowed') {
      showToast('Вхід через Google не налаштовано в Firebase. Перевірте консоль Firebase.');
    } else {
      showToast('Помилка входу: ' + error.message);
    }
  }
};

document.getElementById('appleLoginBtn').onclick = async () => {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      const nickname = user.displayName || user.email?.split('@')[0] || 'user';
      let userId = `@${nickname.toLowerCase()}`;
      const q = query(collection(db, "users"), where("userId", "==", userId));
      const snap = await getDocs(q);
      if (!snap.empty) userId = `@${nickname.toLowerCase()}${Math.floor(Math.random()*1000)}`;
      await setDoc(doc(db, "users", user.uid), {
        nickname,
        userId,
        nickname_lower: nickname.toLowerCase(),
        bio: '',
        avatar: user.photoURL || '',
        posts: [],
        likedPosts: [],
        savedPosts: [],
        followers: [],
        following: [],
        mutedUsers: [],
        blockedUsers: [],
        createdAt: serverTimestamp(),
        lastOnline: serverTimestamp(),
        email: user.email
      });
    }
    showToast('Вхід через Apple успішний');
  } catch (error) {
    showToast('Помилка: ' + error.message);
  }
};

document.getElementById('forgotPassword').onclick = async (e) => {
  e.preventDefault();
  const nickname = prompt('Введіть ваш псевдонім (без @)');
  if (!nickname) return;
  
  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (snap.empty) return alert('Користувача не знайдено');
  
  const userData = snap.docs[0].data();
  const email = userData.email;
  if (!email) return alert('Для цього акаунту не вказано email. Увійдіть через Google/Apple або створіть новий акаунт.');
  
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Лист для скидання пароля відправлено');
  } catch (err) {
    showToast('Помилка: ' + err.message);
  }
};

onAuthStateChanged(auth, (user) => {
  cleanupListeners();
  
  if (user) {
    currentUser = user;
    currentProfileUid = user.uid;
    const authBox = document.getElementById('authBox');
    if (authBox) authBox.style.display = 'none';
    const newPostBox = document.getElementById('newPostBox');
    if (newPostBox) newPostBox.style.display = 'block';
    
    lastOnlineInterval = setInterval(() => {
      updateDoc(doc(db, "users", currentUser.uid), { lastOnline: serverTimestamp() }).catch(console.error);
    }, 30000);
    
    const userRef = doc(db, "users", currentUser.uid);
    unsubscribeFollowing = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        currentUserFollowing = docSnap.data().following || [];
        document.querySelectorAll('.follow-btn-post').forEach(btn => {
          const targetUid = btn.dataset.uid;
          if (targetUid) {
            const isFollowing = currentUserFollowing.includes(targetUid);
            btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
            btn.classList.toggle('following', isFollowing);
          }
        });
      }
    }, (error) => {
      console.error('Error in following snapshot:', error);
    });
    
    resetPagination();
    loadMyProfile();
    
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
    unsubscribeChatList = onSnapshot(q, (snapshot) => {
      let totalUnread = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.unread && data.unread[currentUser.uid]) {
          totalUnread += data.unread[currentUser.uid];
        }
      });
      unreadCount = totalUnread;
      updateUnreadBadge();
      if (document.getElementById('chats')?.classList.contains('active')) {
        loadChatList();
      }
    }, (error) => {
      console.error('Chat list snapshot error:', error);
      alert('Помилка в реальному часі (список чатів):\n' + error.message + '\nКод: ' + error.code);
      showToast('Помилка оновлення списку чатів. Перевірте індекси Firestore.');
    });

    setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
    setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');

    setupFileInput('postMedia', 'postMediaLabel', 'postMediaPreview');
    setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
    setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostMediaPreview');

    setTimeout(() => {
      const content = document.querySelector('.content');
      if (content) {
        content.setAttribute('tabindex', '-1');
        content.focus({ preventScroll: true });
      }
      ensureFocus();
    }, 500);
  } else {
    currentUser = null;
    currentUserFollowing = [];
    const authBox = document.getElementById('authBox');
    if (authBox) authBox.style.display = 'block';
    const newPostBox = document.getElementById('newPostBox');
    if (newPostBox) newPostBox.style.display = 'none';
    unreadCount = 0;
    updateUnreadBadge();
    setTimeout(() => { ensureFocus(); }, 500);
  }
});

// ================= Стрічка з кнопкою підписки =================
document.getElementById('feedNewBtn').onclick = () => {
  if (currentFeedType === 'new') return;
  currentFeedType = 'new';
  resetPagination();
};
document.getElementById('feedPopularBtn').onclick = () => {
  if (currentFeedType === 'popular') return;
  currentFeedType = 'popular';
  resetPagination();
};

function resetPagination() {
  lastVisible = null;
  hasMore = true;
  const feed = document.getElementById('feed');
  if (feed) feed.innerHTML = '';
  loadMorePosts();
}

document.getElementById('addPost').onclick = async () => {
  if (!currentUser) return alert('Увійдіть');
  const text = document.getElementById('postText').value.trim();
  const file = document.getElementById('postMedia').files[0];
  if (!text && !file) return alert('Додайте текст або медіа');
  try {
    let mediaUrl = '', mediaType = '';
    if (file) {
      const storageRef = ref(storage, `posts/${currentUser.uid}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      mediaUrl = await getDownloadURL(storageRef);
      mediaType = file.type.split('/')[0];
    }
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userSnap.data();
    
    const hashtags = extractHashtags(text);
    
    const postDoc = await addDoc(collection(db, "posts"), {
      author: currentUser.uid,
      authorType: 'user',
      authorName: userData.nickname,
      authorUserId: userData.userId,
      authorAvatar: userData.avatar || '',
      text,
      mediaUrl,
      mediaType,
      createdAt: serverTimestamp(),
      likes: [],
      likesCount: 0,
      commentsCount: 0,
      saves: [],
      views: 0,
      hashtags: hashtags
    });
    await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayUnion(postDoc.id) });
    document.getElementById('postText').value = '';
    document.getElementById('postMedia').value = '';
    document.getElementById('postMediaLabel').textContent = 'Обрати фото/відео';
    document.getElementById('postMediaPreview').classList.remove('show');
    showToast('Пост опубліковано!');
  } catch (e) { showToast(e.message); }
};

async function loadMorePosts() {
  if (!currentUser || loading || !hasMore) return;
  loading = true;
  const skeleton = document.getElementById('skeletonContainer');
  if (skeleton) skeleton.style.display = 'block';
  
  try {
    let q;
    if (currentFeedType === 'new') {
      q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(10));
    } else {
      q = query(collection(db, "posts"), orderBy("likesCount", "desc"), orderBy("createdAt", "desc"), limit(10));
    }
    if (lastVisible) q = query(q, startAfter(lastVisible));
    
    const snapshot = await getDocs(q);
    if (snapshot.empty) { hasMore = false; return; }
    
    lastVisible = snapshot.docs[snapshot.docs.length - 1];
    renderPosts(snapshot.docs);
  } catch (e) {
    console.error("Помилка завантаження постів:", e);
    alert('Помилка завантаження постів:\n' + e.message + '\nКод: ' + e.code);
    showToast("Помилка завантаження. Перевірте індекси Firestore.");
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    loading = false;
    ensureFocus();
  }
}

async function loadComments(postId, container) {
  const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
  const snapshot = await getDocs(q);
  container.innerHTML = '';
  snapshot.forEach(doc => {
    const comment = doc.data();
    const commentEl = document.createElement('div');
    commentEl.className = 'comment';
    commentEl.innerHTML = `
      <div class="comment-avatar" style="background-image:url(${comment.authorAvatar || ''})" data-uid="${comment.author}"></div>
      <div class="comment-content">
        <div>
          <span class="comment-author" data-uid="${comment.author}">${comment.authorName}</span>
          <span class="comment-time">${new Date(comment.createdAt?.seconds * 1000).toLocaleString()}</span>
        </div>
        <div class="comment-text">${comment.text}</div>
      </div>
    `;
    container.appendChild(commentEl);
  });
}

async function addComment(postId, text) {
  if (!currentUser || !text.trim()) return;
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  const user = userSnap.data();
  const commentRef = collection(db, `posts/${postId}/comments`);
  await addDoc(commentRef, {
    author: currentUser.uid,
    authorName: user.nickname,
    authorAvatar: user.avatar || '',
    text: text.trim(),
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "posts", postId), { commentsCount: increment(1) });
}

async function incrementPostView(postId) {
  if (!currentUser) return;
  if (viewedPosts.has(postId)) return;
  viewedPosts.add(postId);
  try {
    await updateDoc(doc(db, "posts", postId), { views: increment(1) });
  } catch (e) {
    console.warn("Не вдалося оновити перегляди:", e);
  }
}

function renderPosts(docs, container = null) {
  const feed = container || document.getElementById('feed');
  if (!feed) return;
  docs.forEach(docSnap => {
    const post = { id: docSnap.id, ...docSnap.data() };
    const liked = post.likes?.includes(currentUser?.uid) || false;
    const saved = post.saves?.includes(currentUser?.uid) || false;
    const postTime = post.createdAt ? new Date(post.createdAt.seconds * 1000).toLocaleString() : '';
    const isAuthor = currentUser && post.author === currentUser.uid;
    const isFollowing = currentUserFollowing.includes(post.author);
    
    const postEl = document.createElement('div');
    postEl.className = 'post';
    postEl.dataset.postId = post.id;
    postEl.tabIndex = 0;
    
    let actionsHtml = '';
    if (isAuthor) {
      actionsHtml = `
        <div class="post-actions">
          <button class="edit-post-btn" title="Редагувати пост" tabindex="0">⋯</button>
        </div>
      `;
    }
    
    let contentHtml = post.text || '';
    const hashtagRegex = /#(\w+)/g;
    contentHtml = contentHtml.replace(hashtagRegex, '<span class="hashtag" data-tag="$1">#$1</span>');
    
    const followButtonHtml = !isAuthor && currentUser ? 
      `<button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${post.author}" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>` : '';
    
    postEl.innerHTML = `
      ${actionsHtml}
      <div class="post-header">
        <div class="avatar" style="background-image:url(${post.authorAvatar || ''})" data-uid="${post.author}" tabindex="0"></div>
        <div class="post-author-info">
          <div>
            <span class="post-author" data-uid="${post.author}" tabindex="0">${post.authorName || 'Невідомо'}</span>
            <span class="post-meta">${post.authorUserId || ''}</span>
            ${followButtonHtml}
          </div>
          <div class="post-time">${postTime}</div>
        </div>
      </div>
      <div class="post-content">${contentHtml}</div>
      ${post.mediaUrl ? (post.mediaType==='image' ? `<img src="${post.mediaUrl}" class="post-media" loading="lazy" tabindex="0">` : `<video src="${post.mediaUrl}" controls class="post-media" tabindex="0"></video>`) : ''}
      <div class="post-footer">
        <button class="like-btn ${liked ? 'liked' : ''}" data-post-id="${post.id}" tabindex="0">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          <span>${post.likesCount || 0}</span>
        </button>
        <button class="comment-toggle-btn" data-post-id="${post.id}" tabindex="0">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>${post.commentsCount || 0}</span>
        </button>
        <button class="save-btn ${saved ? 'saved' : ''}" data-post-id="${post.id}" tabindex="0">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
        <span class="view-count" title="Перегляди">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7z"/></svg>
          ${post.views || 0}
        </span>
      </div>
      <div class="comments-section" id="comments-${post.id}" style="display: none;">
        <div class="comments-list" id="comments-list-${post.id}"></div>
        <div class="comment-form">
          <input type="text" id="comment-input-${post.id}" class="comment-input" placeholder="Напишіть коментар..." tabindex="0">
          <div class="emoji-picker-container" style="position: relative;">
            <button class="emoji-button" id="comment-emoji-${post.id}" tabindex="0">😊</button>
            <div class="emoji-picker" id="comment-picker-${post.id}" style="display: none; bottom: 100%; right: 0; position: absolute;"></div>
          </div>
          <button class="btn btn-primary btn-icon" id="submit-comment-${post.id}" tabindex="0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    `;
    feed.appendChild(postEl);

    incrementPostView(post.id);

    const followBtn = postEl.querySelector('.follow-btn-post');
    if (followBtn) {
      followBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFollow(post.author, followBtn);
      });
    }

    if (isAuthor) {
      postEl.querySelector('.edit-post-btn').onclick = () => openEditPostModal(post);
    }

    postEl.querySelectorAll('.hashtag').forEach(span => {
      span.onclick = (e) => {
        e.stopPropagation();
        const tag = span.dataset.tag;
        searchHashtag(tag);
      };
    });

    const commentInput = document.getElementById(`comment-input-${post.id}`);
    if (commentInput) {
      setupEmojiPicker(`comment-emoji-${post.id}`, `comment-picker-${post.id}`, `comment-input-${post.id}`);
    }

    const toggleBtn = postEl.querySelector('.comment-toggle-btn');
    const commentsSection = postEl.querySelector('.comments-section');
    toggleBtn.onclick = async () => {
      if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        const commentsList = document.getElementById(`comments-list-${post.id}`);
        if (commentsList) await loadComments(post.id, commentsList);
        setTimeout(() => { requestFocusUpdate(); }, 100);
      } else {
        commentsSection.style.display = 'none';
      }
    };

    const submitBtn = document.getElementById(`submit-comment-${post.id}`);
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        try {
          await addComment(post.id, text);
          commentInput.value = '';
          const commentsList = document.getElementById(`comments-list-${post.id}`);
          if (commentsList) await loadComments(post.id, commentsList);
          const countSpan = toggleBtn.querySelector('span');
          if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;
          showToast('Коментар додано');
        } catch (error) {
          console.error('Error adding comment:', error);
          showToast('Помилка: ' + error.message);
        }
      };
    }
  });
  ensureFocus();
}

async function toggleFollow(targetUid, buttonElement) {
  if (!currentUser) return;
  
  const wasFollowing = currentUserFollowing.includes(targetUid);
  const newFollowingState = !wasFollowing;
  
  if (newFollowingState) {
    currentUserFollowing.push(targetUid);
  } else {
    currentUserFollowing = currentUserFollowing.filter(id => id !== targetUid);
  }
  
  if (buttonElement) {
    buttonElement.textContent = newFollowingState ? 'Відписатися' : 'Підписатися';
    buttonElement.classList.toggle('following', newFollowingState);
  }
  
  try {
    const myRef = doc(db, "users", currentUser.uid);
    const targetRef = doc(db, "users", targetUid);
    
    if (wasFollowing) {
      await updateDoc(myRef, { following: arrayRemove(targetUid) });
      await updateDoc(targetRef, { followers: arrayRemove(currentUser.uid) });
    } else {
      await updateDoc(myRef, { following: arrayUnion(targetUid) });
      await updateDoc(targetRef, { followers: arrayUnion(currentUser.uid) });
      vibrate(30);
    }
  } catch (error) {
    console.error('Follow error:', error);
    if (newFollowingState) {
      currentUserFollowing = currentUserFollowing.filter(id => id !== targetUid);
    } else {
      currentUserFollowing.push(targetUid);
    }
    if (buttonElement) {
      buttonElement.textContent = wasFollowing ? 'Відписатися' : 'Підписатися';
      buttonElement.classList.toggle('following', wasFollowing);
    }
    if (error.code === 'permission-denied') {
      showToast('Помилка: недостатньо прав. Перевірте правила безпеки Firestore.');
    } else {
      showToast('Помилка: ' + (error.message || 'Невідома помилка'));
    }
  }
}

function openEditPostModal(post) {
  currentEditingPost = post;
  document.getElementById('editPostText').value = post.text || '';
  document.getElementById('editPostMedia').value = '';
  document.getElementById('editPostMediaLabel').textContent = 'Змінити медіа';
  const preview = document.getElementById('editPostMediaPreview');
  preview.classList.remove('show');
  if (post.mediaUrl) {
    if (post.mediaType === 'image') {
      preview.src = post.mediaUrl;
      preview.classList.add('show');
    }
  }
  document.getElementById('editPostModal').classList.add('active');
  TVNavigation.setLastFocusedBeforeModal(document.querySelector('.focused') || document.activeElement);
  setTimeout(() => { requestFocusUpdate(); focusFirstInContainer(document.getElementById('editPostModal')); }, 50);
}

document.getElementById('closeEditPostModal').onclick = () => {
  document.getElementById('editPostModal').classList.remove('active');
  currentEditingPost = null;
  setTimeout(() => {
    requestFocusUpdate();
    const last = TVNavigation.getFocusableElements().includes(lastFocusedElementBeforeModal) ? lastFocusedElementBeforeModal : null;
    if (last) {
      setFocusOnElement(last);
      TVNavigation.clearLastFocusedBeforeModal();
    } else {
      ensureFocus();
    }
  }, 50);
};

document.getElementById('savePostEdit').onclick = async () => {
  if (!currentEditingPost || !currentUser) return;
  const newText = document.getElementById('editPostText').value.trim();
  const file = document.getElementById('editPostMedia').files[0];
  try {
    const postRef = doc(db, "posts", currentEditingPost.id);
    let updateData = { text: newText };
    updateData.hashtags = extractHashtags(newText);
    if (file) {
      if (currentEditingPost.mediaUrl) {
        try {
          const oldMediaRef = ref(storage, currentEditingPost.mediaUrl);
          await deleteObject(oldMediaRef);
        } catch (e) {}
      }
      const storageRef = ref(storage, `posts/${currentUser.uid}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const mediaUrl = await getDownloadURL(storageRef);
      const mediaType = file.type.split('/')[0];
      updateData.mediaUrl = mediaUrl;
      updateData.mediaType = mediaType;
    }
    await updateDoc(postRef, updateData);
    showToast('Пост оновлено');
    document.getElementById('editPostModal').classList.remove('active');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
};

document.getElementById('deletePostBtn').onclick = async () => {
  if (!currentEditingPost || !currentUser) return;
  if (!confirm('Видалити пост?')) return;
  try {
    if (currentEditingPost.mediaUrl) {
      try {
        const mediaRef = ref(storage, currentEditingPost.mediaUrl);
        await deleteObject(mediaRef);
      } catch (e) {}
    }
    await deleteDoc(doc(db, "posts", currentEditingPost.id));
    await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayRemove(currentEditingPost.id) });
    showToast('Пост видалено');
    document.getElementById('editPostModal').classList.remove('active');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
};

async function loadSearchUsers() {
  if (!currentUser) return;
  const val = document.getElementById('searchInput').value.trim().toLowerCase();
  const userList = document.getElementById('userList');
  if (!val) { userList.innerHTML = ''; return; }

  if (val.startsWith('#')) {
    const tag = val.substring(1);
    const q = query(collection(db, "posts"), where("hashtags", "array-contains", tag));
    const snapshot = await getDocs(q);
    userList.innerHTML = '<h3 style="margin-bottom:12px;">Пости з тегом</h3>';
    if (snapshot.empty) {
      userList.innerHTML += '<p>Немає постів з цим тегом</p>';
    } else {
      const feedDiv = document.createElement('div');
      feedDiv.className = 'feed';
      userList.appendChild(feedDiv);
      renderPosts(snapshot.docs, feedDiv);
    }
    return;
  }
  
  const mySnap = await getDoc(doc(db, "users", currentUser.uid));
  const myFollowing = mySnap.data().following || [];
  
  const q1 = query(collection(db, "users"), where("userId", ">=", val.startsWith('@') ? val : `@${val}`), where("userId", "<=", (val.startsWith('@') ? val : `@${val}`) + '\uf8ff'));
  const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));
  
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  const usersMap = new Map();
  snap1.forEach(d => usersMap.set(d.id, d.data()));
  snap2.forEach(d => usersMap.set(d.id, d.data()));
  
  userList.innerHTML = '';
  usersMap.forEach((data, uid) => {
    if (uid === currentUser.uid) return;
    const isFollowing = myFollowing.includes(uid);
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.tabIndex = 0;
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${data.avatar || ''})" tabindex="0"></div>
      <div class="chat-info">
        <div class="chat-name">${data.nickname}</div>
        <div class="chat-last">${data.userId}</div>
      </div>
      <button class="btn follow-btn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
    `;
    const followBtn = div.querySelector('.follow-btn');
    followBtn.onclick = async (e) => {
      e.stopPropagation();
      await toggleFollow(uid, followBtn);
    };
    div.onclick = () => viewProfile(uid);
    userList.appendChild(div);
  });
}
document.getElementById('searchInput').addEventListener('input', loadSearchUsers);

async function loadMyProfile() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists()) renderProfile(snap.data(), currentUser.uid, true);
}

function viewProfile(uid) {
  currentProfileUid = uid;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const profileNav = document.querySelector('[data-section="profile"]');
  if (profileNav) profileNav.classList.add('active');
  sections.forEach(s => document.getElementById(s).classList.remove('active'));
  const profileSection = document.getElementById('profile');
  if (profileSection) profileSection.classList.add('active');
  document.getElementById('pageTitle').textContent = 'Профіль';
  
  if (uid === currentUser?.uid) {
    loadMyProfile();
  } else {
    loadUserProfile(uid);
  }
  
  closeSidebar();
}

async function loadUserProfile(uid) {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) renderProfile(snap.data(), uid, uid === currentUser.uid);
}

function renderProfile(data, uid, isOwn) {
  const header = document.getElementById('profileHeader');
  if (!header) return;

  if (!isOwn && currentUser && data.blockedUsers?.includes(currentUser.uid)) {
    header.innerHTML = `
      <div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div>
      <div>
        <h2>${data.nickname}</h2>
        <p class="text-danger">Цей користувач вас заблокував</p>
      </div>
    `;
    return;
  }

  const isFollowing = !isOwn && currentUser ? (data.followers?.includes(currentUser.uid) || false) : false;

  header.innerHTML = `
    <div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div>
    <div style="flex:1">
      <h2>${data.nickname}</h2>
      <div class="user-id">${data.userId}</div>
      <p>${data.bio || ''}</p>
      <div class="profile-stats">
        <span id="followersCount" data-uid="${uid}">${data.followers?.length || 0} підписників</span>
        <span id="followingCount" data-uid="${uid}">${data.following?.length || 0} підписок</span>
        <span>${data.posts?.length || 0} постів</span>
      </div>
      ${!isOwn && currentUser ? `
        <div style="display:flex; gap:10px; margin-top:10px; align-items:center;">
          <button class="btn" id="profileFollowBtn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
          <button class="btn" id="profileMessageBtn" tabindex="0">Написати</button>
        </div>
      ` : ''}
      ${isOwn ? '<button class="btn" id="editProfileBtn" tabindex="0">Редагувати</button>' : ''}
    </div>
    ${!isOwn && currentUser ? `
      <div class="profile-menu">
        <button class="profile-menu-btn" id="profileMenuBtn" tabindex="0">⋯</button>
        <div class="profile-menu-dropdown" id="profileMenuDropdown">
          <div class="profile-menu-item" id="reportUserBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.5 6.5L21 9l-5 4 2 7-6-4-6 4 2-7-5-4 6.5-.5L12 2z"/></svg>
            Поскаржитися
          </div>
          <div class="profile-menu-item" id="muteUserBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h3l4-4v12l-4-4H3v-4z"/><line x1="18" y1="7" x2="22" y2="11"/><line x1="18" y1="11" x2="22" y2="7"/></svg>
            Замутити в чатах
          </div>
          <div class="profile-menu-item" id="blockUserBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            Заблокувати
          </div>
        </div>
      </div>
    ` : ''}
  `;

  const followersCount = document.getElementById('followersCount');
  if (followersCount) {
    followersCount.style.cursor = 'pointer';
    followersCount.onclick = () => openFollowersList(uid);
  }
  const followingCount = document.getElementById('followingCount');
  if (followingCount) {
    followingCount.style.cursor = 'pointer';
    followingCount.onclick = () => openFollowingList(uid);
  }

  if (!isOwn && currentUser) {
    const profileFollowBtn = document.getElementById('profileFollowBtn');
    if (profileFollowBtn) {
      profileFollowBtn.onclick = async () => {
        await toggleFollow(uid, profileFollowBtn);
      };
    }
    const profileMessageBtn = document.getElementById('profileMessageBtn');
    if (profileMessageBtn) {
      profileMessageBtn.onclick = () => {
        openChat(data.nickname, uid, data.userId);
      };
    }

    const menuBtn = document.getElementById('profileMenuBtn');
    const dropdown = document.getElementById('profileMenuDropdown');
    if (menuBtn && dropdown) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) {
          setTimeout(() => { 
            requestFocusUpdate(); 
            const firstItem = dropdown.querySelector('.profile-menu-item');
            if (firstItem) setFocusOnElement(firstItem);
          }, 50);
        } else {
          setTimeout(() => { requestFocusUpdate(); setFocusOnElement(menuBtn); }, 50);
        }
      };
      document.addEventListener('click', (e) => {
        if (!menuBtn.contains(e.target)) {
          dropdown.classList.remove('show');
        }
      });

      document.getElementById('reportUserBtn').onclick = async () => {
        dropdown.classList.remove('show');
        const reason = prompt('Опишіть причину скарги (необов\'язково)');
        await reportUser(uid, reason);
      };
      document.getElementById('muteUserBtn').onclick = async () => {
        dropdown.classList.remove('show');
        const userRef = doc(db, "users", currentUser.uid);
        const snap = await getDoc(userRef);
        const muted = snap.data().mutedUsers || [];
        if (muted.includes(uid)) {
          await unmuteUser(uid);
        } else {
          await muteUser(uid);
        }
      };
      document.getElementById('blockUserBtn').onclick = async () => {
        dropdown.classList.remove('show');
        const userRef = doc(db, "users", currentUser.uid);
        const snap = await getDoc(userRef);
        const blocked = snap.data().blockedUsers || [];
        if (blocked.includes(uid)) {
          await unblockUser(uid);
        } else {
          await blockUser(uid);
        }
        loadUserProfile(uid);
      };
    }
  }
  if (isOwn) {
    const editProfileBtn = document.getElementById('editProfileBtn');
    if (editProfileBtn) {
      editProfileBtn.onclick = () => {
        document.getElementById('editNickname').value = data.nickname;
        document.getElementById('editBio').value = data.bio || '';
        document.getElementById('editAvatar').value = '';
        document.getElementById('editAvatarLabel').textContent = 'Обрати аватар';
        document.getElementById('editAvatarPreview').classList.remove('show');
        document.getElementById('editProfileModal').classList.add('active');
        TVNavigation.setLastFocusedBeforeModal(document.querySelector('.focused') || document.activeElement);
        setTimeout(() => { requestFocusUpdate(); focusFirstInContainer(document.getElementById('editProfileModal')); }, 50);
      };
    }
  }
  
  const tabs = document.getElementById('profileTabs');
  if (tabs) {
    tabs.innerHTML = `
      <div class="profile-tab active" data-tab="posts" tabindex="0">Пости</div>
      <div class="profile-tab" data-tab="likes" tabindex="0">Лайки</div>
      <div class="profile-tab" data-tab="media" tabindex="0">Медіа</div>
      <div class="profile-tab" data-tab="saved" tabindex="0">Збережене</div>
    `;
    document.querySelectorAll('.profile-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadProfileFeed(uid, tab.dataset.tab);
      };
    });
  }
  loadProfileFeed(uid, 'posts');
}

async function openFollowersList(uid) {
  const modal = document.getElementById('followersModal');
  const list = document.getElementById('followersList');
  if (!modal || !list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  modal.classList.add('active');
  TVNavigation.setLastFocusedBeforeModal(document.querySelector('.focused') || document.activeElement);
  
  const userSnap = await getDoc(doc(db, "users", uid));
  const followersIds = userSnap.data().followers || [];
  const followers = [];
  for (const id of followersIds) {
    const snap = await getDoc(doc(db, "users", id));
    if (snap.exists()) followers.push({ id, ...snap.data() });
  }
  
  list.innerHTML = '';
  if (followers.length === 0) {
    list.innerHTML = '<p style="text-align:center; padding:20px;">Немає підписників</p>';
  } else {
    followers.forEach(user => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="avatar small" style="background-image:url(${user.avatar || ''})" data-uid="${user.id}" tabindex="0"></div>
        <div class="chat-info">
          <div class="chat-name">${user.nickname}</div>
          <div class="chat-last">${user.userId}</div>
        </div>
      `;
      div.onclick = () => {
        viewProfile(user.id);
        modal.classList.remove('active');
      };
      list.appendChild(div);
    });
  }
  setTimeout(() => { requestFocusUpdate(); focusFirstInContainer(modal); }, 100);
}

async function openFollowingList(uid) {
  const modal = document.getElementById('followingModal');
  const list = document.getElementById('followingList');
  if (!modal || !list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  modal.classList.add('active');
  TVNavigation.setLastFocusedBeforeModal(document.querySelector('.focused') || document.activeElement);
  
  const userSnap = await getDoc(doc(db, "users", uid));
  const followingIds = userSnap.data().following || [];
  const following = [];
  for (const id of followingIds) {
    const snap = await getDoc(doc(db, "users", id));
    if (snap.exists()) following.push({ id, ...snap.data() });
  }
  
  list.innerHTML = '';
  if (following.length === 0) {
    list.innerHTML = '<p style="text-align:center; padding:20px;">Ні на кого не підписаний</p>';
  } else {
    following.forEach(user => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="avatar small" style="background-image:url(${user.avatar || ''})" data-uid="${user.id}" tabindex="0"></div>
        <div class="chat-info">
          <div class="chat-name">${user.nickname}</div>
          <div class="chat-last">${user.userId}</div>
        </div>
      `;
      div.onclick = () => {
        viewProfile(user.id);
        modal.classList.remove('active');
      };
      list.appendChild(div);
    });
  }
  setTimeout(() => { requestFocusUpdate(); focusFirstInContainer(modal); }, 100);
}

document.getElementById('closeFollowersModal').onclick = () => {
  document.getElementById('followersModal').classList.remove('active');
  setTimeout(() => {
    requestFocusUpdate();
    const last = TVNavigation.getFocusableElements().includes(lastFocusedElementBeforeModal) ? lastFocusedElementBeforeModal : null;
    if (last) {
      setFocusOnElement(last);
      TVNavigation.clearLastFocusedBeforeModal();
    } else {
      ensureFocus();
    }
  }, 50);
};
document.getElementById('closeFollowingModal').onclick = () => {
  document.getElementById('followingModal').classList.remove('active');
  setTimeout(() => {
    requestFocusUpdate();
    const last = TVNavigation.getFocusableElements().includes(lastFocusedElementBeforeModal) ? lastFocusedElementBeforeModal : null;
    if (last) {
      setFocusOnElement(last);
      TVNavigation.clearLastFocusedBeforeModal();
    } else {
      ensureFocus();
    }
  }, 50);
};

async function loadProfileFeed(uid, tab) {
  if (!currentUser) return;
  const feed = document.getElementById('profileFeed');
  if (!feed) return;
  feed.innerHTML = '';
  let posts = [];
  const userSnap = await getDoc(doc(db, "users", uid));
  const userData = userSnap.data();
  
  if (tab === 'posts') {
    const postIds = userData.posts || [];
    for (const id of postIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
    }
  } else if (tab === 'likes') {
    const likedIds = userData.likedPosts || [];
    for (const id of likedIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
    }
  } else if (tab === 'media') {
    const q = query(collection(db, "posts"), where("author", "==", uid), where("mediaUrl", "!=", ""));
    const snap = await getDocs(q);
    snap.forEach(d => posts.push({ id: d.id, ...d.data() }));
  } else if (tab === 'saved') {
    const savedIds = userData.savedPosts || [];
    for (const id of savedIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
    }
  }
  
  posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  
  posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post';
    div.tabIndex = 0;
    div.innerHTML = `<div class="post-content">${post.text || ''}</div>`;
    feed.appendChild(div);
  });
}

document.getElementById('closeModal').onclick = () => {
  document.getElementById('editProfileModal').classList.remove('active');
  setTimeout(() => {
    requestFocusUpdate();
    const last = TVNavigation.getFocusableElements().includes(lastFocusedElementBeforeModal) ? lastFocusedElementBeforeModal : null;
    if (last) {
      setFocusOnElement(last);
      TVNavigation.clearLastFocusedBeforeModal();
    } else {
      ensureFocus();
    }
  }, 50);
};

document.getElementById('saveProfileEdit').onclick = async () => {
  if (!currentUser) return;
  const nickname = document.getElementById('editNickname').value.trim();
  const bio = document.getElementById('editBio').value.trim();
  const avatarFile = document.getElementById('editAvatar').files[0];
  if (!nickname) return alert('Псевдонім обов’язковий');
  
  const newUserId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", newUserId));
  const snap = await getDocs(q);
  if (!snap.empty && snap.docs[0].id !== currentUser.uid) return alert('Цей ID вже зайнятий');
  
  try {
    let avatarUrl;
    if (avatarFile) {
      const storageRef = ref(storage, `avatars/${currentUser.uid}/${Date.now()}_${avatarFile.name}`);
      await uploadBytes(storageRef, avatarFile);
      avatarUrl = await getDownloadURL(storageRef);
    }
    
    const updateData = { 
      nickname, 
      userId: newUserId, 
      nickname_lower: nickname.toLowerCase(), 
      bio 
    };
    if (avatarUrl) updateData.avatar = avatarUrl;
    
    await updateDoc(doc(db, "users", currentUser.uid), updateData);
    loadMyProfile();
    document.getElementById('editProfileModal').classList.remove('active');
    showToast('Профіль оновлено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
};

const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

async function loadChatList() {
  if (!currentUser) return;
  const list = document.getElementById('chatList');
  if (!list) return;
  list.innerHTML = '';

  try {
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      list.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
      return;
    }

    const chatItems = [];
    for (const docSnap of snapshot.docs) {
      const chat = docSnap.data();
      const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
      if (!otherUid) continue;

      const userSnap = await getDoc(doc(db, "users", otherUid));
      const user = userSnap.data();
      if (!user) continue;

      const unread = chat.unread?.[currentUser.uid] || 0;
      const lastMsg = chat.lastMessage || '';
      const updatedAt = chat.updatedAt?.seconds || 0;
      const time = updatedAt ? new Date(updatedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const lastOnline = user.lastOnline?.seconds || 0;
      const isOnline = (Date.now() / 1000 - lastOnline) < 60;

      chatItems.push({
        chatId: docSnap.id,
        otherUid,
        user,
        unread,
        lastMsg,
        time,
        isOnline,
        updatedAt
      });
    }

    chatItems.sort((a, b) => b.updatedAt - a.updatedAt);

    if (chatItems.length === 0) {
      list.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
      return;
    }

    chatItems.forEach(item => {
      const div = document.createElement('div');
      div.className = `chat-item ${item.unread > 0 ? 'unread' : ''}`;
      div.dataset.chatId = item.chatId;
      div.dataset.otherUid = item.otherUid;
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="avatar small" style="background-image:url(${item.user.avatar || ''})" tabindex="0"></div>
        <div class="chat-info">
          <div class="chat-name">${item.user.nickname} ${item.isOnline ? '<span class="online-indicator" style="display:inline-block;"></span>' : ''}</div>
          <div class="chat-last">${item.lastMsg}</div>
        </div>
        <div class="chat-time">${item.time}</div>
        ${item.unread > 0 ? `<div class="chat-badge">${item.unread}</div>` : ''}
      `;
      div.onclick = () => openChatFromList(item.chatId, item.otherUid, item.user.nickname, item.user.userId, item.user.avatar);
      list.appendChild(div);
    });
  } catch (error) {
    console.error('Error loading chat list:', error);
    alert('Помилка завантаження списку чатів:\n' + (error.message || 'Невідома помилка') + '\nКод: ' + (error.code || 'N/A'));
    showToast('Помилка завантаження списку чатів.');
  }
}

async function openChatFromList(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  if (!currentUser) return;
  currentChatPartner = otherUid;
  currentChatPartnerName = otherName;
  currentChatId = chatId;
  
  const chatWindow = document.getElementById('chatWindow');
  if (chatWindow) chatWindow.style.display = 'flex';
  const chatName = document.getElementById('chatName');
  if (chatName) chatName.textContent = otherName;
  const chatUserId = document.getElementById('chatUserId');
  if (chatUserId) chatUserId.textContent = otherUserId || '';
  const chatAvatar = document.getElementById('chatAvatar');
  if (chatAvatar) chatAvatar.style.backgroundImage = `url(${otherAvatar || ''})`;
  
  const chatRef = doc(db, "chats", chatId);
  await updateDoc(chatRef, { [`unread.${currentUser.uid}`]: 0 }).catch(console.error);
  
  setTimeout(() => {
    subscribeToChat(chatId).catch(err => {
      console.error('Error subscribing to chat:', err);
      showToast('Помилка завантаження повідомлень');
    });
  }, 100);
  
  if (unsubscribeOnlineStatus) unsubscribeOnlineStatus();
  unsubscribeOnlineStatus = onSnapshot(doc(db, "users", otherUid), (snap) => {
    const lastOnline = snap.data()?.lastOnline?.seconds || 0;
    const isOnline = (Date.now()/1000 - lastOnline) < 60;
    const indicator = document.getElementById('onlineIndicator');
    if (indicator) indicator.style.display = isOnline ? 'inline-block' : 'none';
  }, (error) => {
    console.error('Online status error:', error);
  });
  
  setTimeout(() => { requestFocusUpdate(); setFocusOnElement(document.getElementById('chatText')); }, 200);
}

function openChat(otherName, otherUid, otherUserId) {
  if (!currentUser) return;
  currentChatPartner = otherUid;
  currentChatPartnerName = otherName;
  
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const chatsNav = document.querySelector('[data-section="chats"]');
  if (chatsNav) chatsNav.classList.add('active');
  sections.forEach(s => document.getElementById(s).classList.remove('active'));
  const chatsSection = document.getElementById('chats');
  if (chatsSection) chatsSection.classList.add('active');
  document.getElementById('pageTitle').textContent = 'Чати';
  
  const chatWindow = document.getElementById('chatWindow');
  if (chatWindow) chatWindow.style.display = 'flex';
  const chatName = document.getElementById('chatName');
  if (chatName) chatName.textContent = otherName;
  const chatUserId = document.getElementById('chatUserId');
  if (chatUserId) chatUserId.textContent = otherUserId || '';
  
  getDoc(doc(db, "users", otherUid)).then(snap => {
    if (snap.exists()) {
      const chatAvatar = document.getElementById('chatAvatar');
      if (chatAvatar) chatAvatar.style.backgroundImage = `url(${snap.data().avatar || ''})`;
      const lastOnline = snap.data().lastOnline?.seconds || 0;
      const isOnline = (Date.now()/1000 - lastOnline) < 60;
      const indicator = document.getElementById('onlineIndicator');
      if (indicator) indicator.style.display = isOnline ? 'inline-block' : 'none';
    }
  }).catch(console.error);
  
  if (unsubscribeOnlineStatus) unsubscribeOnlineStatus();
  unsubscribeOnlineStatus = onSnapshot(doc(db, "users", otherUid), (snap) => {
    const lastOnline = snap.data()?.lastOnline?.seconds || 0;
    const isOnline = (Date.now()/1000 - lastOnline) < 60;
    const indicator = document.getElementById('onlineIndicator');
    if (indicator) indicator.style.display = isOnline ? 'inline-block' : 'none';
  }, (error) => {
    console.error('Online status error:', error);
  });
  
  const chatId = getChatId(currentUser.uid, otherUid);
  currentChatId = chatId;
  const chatRef = doc(db, "chats", chatId);
  getDoc(chatRef).then(async (docSnap) => {
    try {
      if (!docSnap.exists()) {
        await setDoc(chatRef, {
          participants: [currentUser.uid, otherUid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastMessage: '',
          unread: { [currentUser.uid]: 0, [otherUid]: 0 }
        });
      } else {
        await updateDoc(chatRef, { [`unread.${currentUser.uid}`]: 0 });
      }
      setTimeout(() => {
        subscribeToChat(chatId).catch(err => {
          console.error('Error subscribing to chat:', err);
          showToast('Помилка завантаження повідомлень');
        });
      }, 100);
      loadChatList();
    } catch (error) {
      console.error('Error opening chat:', error);
      alert('Помилка відкриття чату:\n' + error.message);
      showToast('Помилка відкриття чату');
    }
  }).catch(error => {
    console.error('Error getting chat doc:', error);
    alert('Помилка доступу до чату:\n' + error.message);
    showToast('Помилка доступу до чату');
  });
  
  setTimeout(() => { requestFocusUpdate(); setFocusOnElement(document.getElementById('chatText')); }, 200);
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMessageDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) return 'Сьогодні';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
  return date.toLocaleDateString();
}

async function subscribeToChat(chatId) {
  if (!currentUser) throw new Error('No current user');
  if (unsubscribeChat) unsubscribeChat();
  if (unsubscribeTyping) unsubscribeTyping();

  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) {
    throw new Error('chatMessages container not found');
  }

  const otherUserSnap = await getDoc(doc(db, "users", currentChatPartner));
  const otherUser = otherUserSnap.data();

  const q = query(collection(db, `chats/${chatId}/messages`), orderBy("createdAt"));
  let lastDate = '';
  unsubscribeChat = onSnapshot(q, (snap) => {
    messagesContainer.innerHTML = '';
    snap.forEach(doc => {
      const msg = doc.data();
      const msgDate = formatMessageDate(msg.createdAt);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = msgDate;
        messagesContainer.appendChild(divider);
      }

      const wrapper = document.createElement('div');
      wrapper.className = `message-wrapper ${msg.from === currentUser.uid ? 'sent' : 'received'}`;

      const bubble = document.createElement('div');
      bubble.className = `message-bubble ${msg.from === currentUser.uid ? 'sent' : 'received'}`;

      if (msg.from !== currentUser.uid) {
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.innerHTML = `
          <div class="message-sender-avatar" style="background-image:url(${otherUser?.avatar || ''})"></div>
          <span>${currentChatPartnerName}</span>
        `;
        bubble.appendChild(senderDiv);
      }

      const textDiv = document.createElement('div');
      textDiv.textContent = msg.text;
      bubble.appendChild(textDiv);

      const timeDiv = document.createElement('div');
      timeDiv.className = 'message-time';
      timeDiv.textContent = formatMessageTime(msg.createdAt);
      bubble.appendChild(timeDiv);

      wrapper.appendChild(bubble);
      messagesContainer.appendChild(wrapper);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, (error) => {
    console.error('Error in messages snapshot:', error);
    alert('Помилка отримання повідомлень:\n' + error.message);
    showToast('Помилка отримання повідомлень');
  });
  
  if (currentChatPartner) {
    const typingRef = doc(db, `chats/${chatId}/typing/${currentChatPartner}`);
    unsubscribeTyping = onSnapshot(typingRef, (docSnap) => {
      const indicator = document.getElementById('typingIndicator');
      if (indicator) {
        if (docSnap.exists() && docSnap.data().isTyping) {
          indicator.style.display = 'flex';
        } else {
          indicator.style.display = 'none';
        }
      }
    }, (error) => {
      console.error('Typing indicator error:', error);
    });
  }
}

document.getElementById('chatText').addEventListener('input', () => {
  if (!currentUser || !currentChatPartner || !currentChatId) return;
  const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
  setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);
  clearTimeout(window.typingTimeout);
  window.typingTimeout = setTimeout(() => setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error), 2000);
});

document.getElementById('sendMessage').onclick = async () => {
  const text = document.getElementById('chatText').value.trim();
  if (!text || !currentUser || !currentChatPartner || !currentChatId) return;
  const chatRef = doc(db, "chats", currentChatId);
  const messageRef = collection(db, `chats/${currentChatId}/messages`);
  try {
    await addDoc(messageRef, { from: currentUser.uid, text, createdAt: serverTimestamp() });
    await updateDoc(chatRef, {
      lastMessage: text,
      updatedAt: serverTimestamp(),
      [`unread.${currentChatPartner}`]: increment(1)
    });
    document.getElementById('chatText').value = '';
    
    const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
    await setDoc(typingRef, { isTyping: false }, { merge: true });
  } catch (error) {
    console.error('Send message error:', error);
    alert('Помилка відправлення повідомлення:\n' + error.message);
  }
};

document.getElementById('chatText').addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('sendMessage').click();
  }
});

let searchTimeout;
document.getElementById('chatSearchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const val = e.target.value.trim();
  if (!val) {
    document.getElementById('chatSearchResults').style.display = 'none';
    return;
  }
  searchTimeout = setTimeout(() => searchUsersForChat(val), 300);
});

async function searchUsersForChat(queryText) {
  if (!currentUser) return;
  const val = queryText.toLowerCase();
  const resultsContainer = document.getElementById('chatSearchResults');
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '';
  
  const q1 = query(collection(db, "users"), where("userId", ">=", val.startsWith('@') ? val : `@${val}`), where("userId", "<=", (val.startsWith('@') ? val : `@${val}`) + '\uf8ff'));
  const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));
  
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  const usersMap = new Map();
  snap1.forEach(d => usersMap.set(d.id, d.data()));
  snap2.forEach(d => usersMap.set(d.id, d.data()));
  
  if (usersMap.size === 0) {
    resultsContainer.style.display = 'none';
    return;
  }
  
  resultsContainer.style.display = 'block';
  usersMap.forEach((data, uid) => {
    if (uid === currentUser.uid) return;
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.tabIndex = 0;
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${data.avatar || ''})" tabindex="0"></div>
      <div class="chat-info">
        <div class="chat-name">${data.nickname}</div>
        <div class="chat-last">${data.userId}</div>
      </div>
      <button class="btn" tabindex="0">Написати</button>
    `;
    div.onclick = () => {
      openChat(data.nickname, uid, data.userId);
      resultsContainer.style.display = 'none';
      document.getElementById('chatSearchInput').value = '';
    };
    const btn = div.querySelector('button');
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        openChat(data.nickname, uid, data.userId);
        resultsContainer.style.display = 'none';
        document.getElementById('chatSearchInput').value = '';
      };
    }
    resultsContainer.appendChild(div);
  });
  setTimeout(() => { requestFocusUpdate(); }, 100);
}

document.getElementById('toggleTheme').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

document.getElementById('privacyPolicyBtn').onclick = () => {
  document.getElementById('privacyPolicyModal').classList.add('active');
  TVNavigation.setLastFocusedBeforeModal(document.querySelector('.focused') || document.activeElement);
  setTimeout(() => { requestFocusUpdate(); focusFirstInContainer(document.getElementById('privacyPolicyModal')); }, 50);
};
document.getElementById('closePrivacyModal').onclick = () => {
  document.getElementById('privacyPolicyModal').classList.remove('active');
  setTimeout(() => {
    requestFocusUpdate();
    const last = TVNavigation.getFocusableElements().includes(lastFocusedElementBeforeModal) ? lastFocusedElementBeforeModal : null;
    if (last) {
      setFocusOnElement(last);
      TVNavigation.clearLastFocusedBeforeModal();
    } else {
      ensureFocus();
    }
  }, 50);
};

function updateTvButtons() {
  const tvNavToggle = document.getElementById('tvNavToggle');
  if (tvNavToggle) tvNavToggle.textContent = `TV-навігація: ${tvSettings.tvNavEnabled ? 'увімкнено' : 'вимкнено'}`;
  const remoteNavToggle = document.getElementById('remoteNavToggle');
  if (remoteNavToggle) remoteNavToggle.textContent = `Навігація з пульта: ${tvSettings.remoteNavEnabled ? 'увімкнено' : 'вимкнено'}`;
  const focusOptimizeToggle = document.getElementById('focusOptimizeToggle');
  if (focusOptimizeToggle) focusOptimizeToggle.textContent = `Оптимізація фокусу: ${tvSettings.focusOptimized ? 'увімкнено' : 'вимкнено'}`;
  const tvCursorToggle = document.getElementById('tvCursorToggle');
  if (tvCursorToggle) tvCursorToggle.textContent = `TV-стрілочка: ${tvSettings.tvCursorEnabled ? 'увімкнено' : 'вимкнено'}`;
}
document.getElementById('tvNavToggle').onclick = () => {
  tvSettings.tvNavEnabled = !tvSettings.tvNavEnabled;
  localStorage.setItem('tvNav', tvSettings.tvNavEnabled);
  updateTvButtons();
  if (!tvSettings.tvNavEnabled) {
    document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
    document.getElementById('tvCursor').style.display = 'none';
  } else {
    updateTVCursor(document.querySelector('.focused'));
  }
};
document.getElementById('remoteNavToggle').onclick = () => {
  tvSettings.remoteNavEnabled = !tvSettings.remoteNavEnabled;
  localStorage.setItem('remoteNav', tvSettings.remoteNavEnabled);
  updateTvButtons();
};
document.getElementById('focusOptimizeToggle').onclick = () => {
  tvSettings.focusOptimized = !tvSettings.focusOptimized;
  localStorage.setItem('focusOptimized', tvSettings.focusOptimized);
  updateTvButtons();
};
document.getElementById('tvCursorToggle').onclick = () => {
  tvSettings.tvCursorEnabled = !tvSettings.tvCursorEnabled;
  localStorage.setItem('tvCursor', tvSettings.tvCursorEnabled);
  updateTvButtons();
  updateTVCursor(document.querySelector('.focused'));
};
updateTvButtons();

document.getElementById('logoutBtn').onclick = () => {
  cleanupListeners();
  signOut(auth);
};

const sentinel = document.getElementById('feedSentinel');
if (sentinel) {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMorePosts();
  }, { threshold: 0.5 });
  observer.observe(sentinel);
}

document.addEventListener('click', async (e) => {
  if (!currentUser) return;
  const target = e.target.closest('button');
  if (!target) return;
  
  if (target.classList.contains('like-btn')) {
    const postId = target.dataset.postId;
    const liked = target.classList.contains('liked');
    const countSpan = target.querySelector('span');
    const oldCount = parseInt(countSpan.textContent);
    target.classList.toggle('liked');
    countSpan.textContent = liked ? oldCount - 1 : oldCount + 1;
    try {
      const postRef = doc(db, "posts", postId);
      if (liked) {
        await updateDoc(postRef, { likes: arrayRemove(currentUser.uid), likesCount: increment(-1) });
        await updateDoc(doc(db, "users", currentUser.uid), { likedPosts: arrayRemove(postId) });
      } else {
        await updateDoc(postRef, { likes: arrayUnion(currentUser.uid), likesCount: increment(1) });
        await updateDoc(doc(db, "users", currentUser.uid), { likedPosts: arrayUnion(postId) });
        vibrate(30);
      }
    } catch {
      target.classList.toggle('liked');
      countSpan.textContent = oldCount;
    }
  }
  
  if (target.classList.contains('save-btn')) {
    const postId = target.dataset.postId;
    const saved = target.classList.contains('saved');
    target.classList.toggle('saved');
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const postRef = doc(db, "posts", postId);
      if (saved) {
        await updateDoc(userRef, { savedPosts: arrayRemove(postId) });
        await updateDoc(postRef, { saves: arrayRemove(currentUser.uid) });
      } else {
        await updateDoc(userRef, { savedPosts: arrayUnion(postId
