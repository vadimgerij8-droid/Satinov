import { auth, db } from './config.js';
import {
  state,
  setCurrentUser, setCurrentUserData, setLastOnlineInterval, setUnsubscribeFollowing,
  cleanupAllListeners, setCurrentFeedType, resetPaginationState, updateUnreadCount,
  setUnsubscribeChatList
} from './state.js';
import { showToast, updateLastOnline, updateUnreadBadge, setupEmojiPicker, setupFileInput, debounce } from './utils.js';
import { register, login, googleLogin, appleLogin, resetPassword, logout } from './auth.js';
import { createPost, loadMorePosts, loadHashtags, loadFilterHashtags, clearFilter, extractHashtags } from './posts.js';
import { viewProfile, saveProfileEdit, toggleFollow, openFollowersList, openFollowingList, blockUser } from './profile.js';
import { loadChatList, openChat, closeChat, sendMessage, handleTyping, handleMessageContextAction, searchUsersForChat } from './chat.js';
import { loadSettings, setupSettingsListeners } from './settings.js';
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, onSnapshot, collection, query, where, serverTimestamp, updateDoc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
  const sections = ['home', 'search', 'hashtags', 'profile', 'chats', 'settings'];
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');

  navItems.forEach((item) => {
    item.addEventListener('click', async () => {
      const section = item.dataset.section;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      sections.forEach(s => document.getElementById(s).classList.remove('active'));
      const sectionEl = document.getElementById(section);
      if (sectionEl) sectionEl.classList.add('active');
      const span = item.querySelector('span');
      document.getElementById('pageTitle').textContent = span ? span.textContent : item.textContent.trim();

      if (state.previousSection !== section) {
        state.navigationHistory.push(state.previousSection);
        state.previousSection = section;
      }

      cleanupAllListeners();

      const chatWindow = document.getElementById('chatWindowContainer');
      if (chatWindow) chatWindow.style.display = 'none';
      const chatSidebar = document.getElementById('chatListSidebar');
      if (chatSidebar) chatSidebar.classList.remove('hide');
      document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');
      document.querySelector('.back-btn').classList.remove('visible');

      if (section === 'home' && state.currentUser) {
        resetPagination();
      }
      if (section === 'search' && state.currentUser) {
        await loadSearchUsers();
      }
      if (section === 'hashtags' && state.currentUser) {
        await loadHashtags();
      }
      if (section === 'chats' && state.currentUser) {
        document.getElementById('chatWindowContainer').style.display = 'none';
        document.getElementById('chatListSidebar').classList.remove('hide');
        document.getElementById('chatSearchInput').value = '';
        document.getElementById('chatSearchResults').style.display = 'none';
        await loadChatList();
      }
      if (section === 'profile' && state.currentUser) {
        await viewProfile(state.currentUser.uid);
      }
      if (section === 'settings') {
        loadSettings();
      }
    });
  });

  document.querySelector('.back-btn').addEventListener('click', () => {
    if (state.navigationHistory.length > 0) {
      const prev = state.navigationHistory.pop();
      state.previousSection = prev;
      const navItem = document.querySelector(`.nav-item[data-section="${prev}"]`);
      if (navItem) navItem.click();
    }
  });

  document.getElementById('toRegister').onclick = () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
  };
  document.getElementById('toLogin').onclick = () => {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  };
  document.getElementById('registerBtn').onclick = async () => {
    const nickname = document.getElementById('registerNickname').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    await register(nickname, password);
  };
  document.getElementById('loginBtn').onclick = async () => {
    const nickname = document.getElementById('loginNickname').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    await login(nickname, password);
  };
  document.getElementById('googleLoginBtn').onclick = googleLogin;
  document.getElementById('appleLoginBtn').onclick = appleLogin;
  document.getElementById('forgotPassword').onclick = async (e) => {
    e.preventDefault();
    const nickname = prompt('Введіть ваш псевдонім (без @)');
    if (nickname) await resetPassword(nickname);
  };
  document.getElementById('logoutBtn').onclick = () => {
    // Очищуємо інтервал оновлення онлайн-статусу перед виходом
    if (state.onlineInterval) {
      clearInterval(state.onlineInterval);
      state.onlineInterval = null;
    }
    cleanupAllListeners();
    logout();
  };

  document.getElementById('addPost').onclick = async () => {
    const text = document.getElementById('postText').value.trim();
    const fileInput = document.getElementById('postMedia');
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    await createPost(text, files);
  };

  document.getElementById('saveProfileEdit').onclick = async () => {
    const nickname = document.getElementById('editNickname').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    const note = document.getElementById('editNote').value.trim();
    const avatarFile = document.getElementById('editAvatar').files[0];
    await saveProfileEdit(nickname, bio, note, avatarFile);
  };
  document.getElementById('closeModal').onclick = () => {
    document.getElementById('editProfileModal').classList.remove('active');
  };

  // ДОДАНО: обробник кнопки "Зберегти" у модальному вікні редагування поста
  document.getElementById('savePostEdit').onclick = async () => {
    const modal = document.getElementById('editPostModal');
    const postId = modal.dataset.editingPostId;
    const newText = document.getElementById('editPostText').value.trim();

    if (!postId || !newText) {
      showToast('Текст поста не може бути порожнім');
      return;
    }

    try {
      const hashtags = extractHashtags(newText);
      const postRef = doc(db, 'posts', postId);
      await updateDoc(postRef, { text: newText, hashtags });
      modal.classList.remove('active');
      showToast('Пост оновлено');

      // Оновити текст поста на сторінці без перезавантаження
      const postEl = document.querySelector(`[data-post-id="${postId}"] .post-content`);
      if (postEl) {
        const hashtagRegex = /#(\w+)/g;
        postEl.innerHTML = newText.replace(hashtagRegex, '<span class="hashtag" data-tag="$1">#$1</span>');
      }
    } catch (e) {
      console.error('Помилка збереження поста:', e);
      showToast('Помилка збереження: ' + e.message);
    }
  };

  // ДОДАНО: закриття модального вікна редагування поста
  document.getElementById('closeEditPostModal').onclick = () => {
    document.getElementById('editPostModal').classList.remove('active');
  };

  document.getElementById('searchInput').addEventListener('input', debounce(loadSearchUsers, 300));

  document.getElementById('sendMessage').addEventListener('click', () => {
    const text = document.getElementById('chatText').value.trim();
    const file = document.getElementById('chatAttachFile').files[0];
    sendMessage(text, file);
  });
  document.getElementById('chatText').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('sendMessage').click();
    }
  });
  document.getElementById('chatText').addEventListener('input', handleTyping);
  document.getElementById('chatAttachBtn').addEventListener('click', () => {
    document.getElementById('chatAttachFile').click();
  });
  document.getElementById('chatAttachFile').addEventListener('change', function () {
    const btn = document.getElementById('chatAttachBtn');
    if (btn) btn.innerHTML = this.files && this.files[0] ? '📁' : '📎';
  });
  document.getElementById('chatBackBtn').addEventListener('click', closeChat);
  document.getElementById('chatAvatar').addEventListener('click', () => {
    if (state.currentChatPartner) viewProfile(state.currentChatPartner);
  });
  document.getElementById('chatMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('chatMenuDropdown');
    if (dropdown) dropdown.classList.toggle('show');
  });
  document.addEventListener('click', () => {
    const dropdown = document.getElementById('chatMenuDropdown');
    if (dropdown) dropdown.classList.remove('show');
  });
  document.getElementById('chatMenuDropdown').addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (action === 'viewProfile' && state.currentChatPartner) {
      viewProfile(state.currentChatPartner);
    } else if (action === 'block' && state.currentChatPartner) {
      await blockUser(state.currentChatPartner);
    } else if (action === 'clearHistory' && state.currentChatId) {
      if (confirm('Очистити історію повідомлень?')) {
        // реалізуйте очищення
      }
    }
    document.getElementById('chatMenuDropdown').classList.remove('show');
  });

  document.getElementById('messageContextMenu').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    handleMessageContextAction(action);
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

  setupSettingsListeners();

  document.getElementById('closeFollowersModal').onclick = () => {
    document.getElementById('followersModal').classList.remove('active');
  };
  document.getElementById('closeFollowingModal').onclick = () => {
    document.getElementById('followingModal').classList.remove('active');
  };
  document.getElementById('closePrivacyModal').onclick = () => {
    document.getElementById('privacyPolicyModal').classList.remove('active');
  };
  document.getElementById('privacyPolicyBtn').onclick = () => {
    document.getElementById('privacyPolicyModal').classList.add('active');
  };

  document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    const keysToKeep = ['theme'];
    Object.keys(localStorage).forEach(key => {
      if (!keysToKeep.includes(key)) localStorage.removeItem(key);
    });
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    showToast('Кеш очищено');
  });

  document.getElementById('clearSavedMediaBtn').addEventListener('click', async () => {
    if (!state.currentUser) return;
    if (!confirm('Видалити всі збережені медіа?')) return;
    const userRef = doc(db, "users", state.currentUser.uid);
    await updateDoc(userRef, { savedPosts: [] });
    showToast('Збережені медіа очищено');
  });

  setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
  setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostMediaPreview');
  setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
  setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');

  const postMediaInput = document.getElementById('postMedia');
  const postMediaPreviews = document.getElementById('postMediaPreviews');
  const postMediaLabel = document.getElementById('postMediaLabel');

  if (postMediaInput) {
    postMediaInput.addEventListener('change', function () {
      postMediaPreviews.innerHTML = '';
      const files = Array.from(this.files);
      const maxFiles = 3;
      if (files.length > maxFiles) {
        showToast(`Можна вибрати не більше ${maxFiles} файлів`);
        this.value = '';
        return;
      }
      postMediaLabel.textContent = files.length ? `Вибрано ${files.length} файлів` : '+ Медіа (до 3 файлів)';
      files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const previewContainer = document.createElement('div');
          previewContainer.style.position = 'relative';
          previewContainer.style.width = '80px';
          previewContainer.style.height = '80px';
          if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '8px';
            img.style.border = '1px solid var(--border)';
            previewContainer.appendChild(img);
          } else if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = e.target.result;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.borderRadius = '8px';
            video.style.border = '1px solid var(--border)';
            video.muted = true;
            video.preload = 'metadata';
            video.addEventListener('loadeddata', () => { video.currentTime = 0.1; });
            previewContainer.appendChild(video);
            const playIcon = document.createElement('span');
            playIcon.innerHTML = '▶️';
            playIcon.style.position = 'absolute';
            playIcon.style.top = '50%';
            playIcon.style.left = '50%';
            playIcon.style.transform = 'translate(-50%, -50%)';
            playIcon.style.fontSize = '24px';
            playIcon.style.opacity = '0.7';
            previewContainer.appendChild(playIcon);
          }
          const removeBtn = document.createElement('button');
          removeBtn.innerHTML = '✕';
          removeBtn.style.position = 'absolute';
          removeBtn.style.top = '-5px';
          removeBtn.style.right = '-5px';
          removeBtn.style.width = '22px';
          removeBtn.style.height = '22px';
          removeBtn.style.borderRadius = '50%';
          removeBtn.style.background = 'var(--danger)';
          removeBtn.style.color = 'white';
          removeBtn.style.border = 'none';
          removeBtn.style.cursor = 'pointer';
          removeBtn.style.fontSize = '14px';
          removeBtn.style.display = 'flex';
          removeBtn.style.alignItems = 'center';
          removeBtn.style.justifyContent = 'center';
          removeBtn.style.padding = '0';
          removeBtn.setAttribute('data-index', index);
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dt = new DataTransfer();
            const updatedFiles = files.filter((_, i) => i !== index);
            updatedFiles.forEach(f => dt.items.add(f));
            postMediaInput.files = dt.files;
            postMediaInput.dispatchEvent(new Event('change', { bubbles: true }));
          });
          previewContainer.appendChild(removeBtn);
          postMediaPreviews.appendChild(previewContainer);
        };
        reader.readAsDataURL(file);
      });
    });
  }

  const sentinel = document.getElementById('feedSentinel');
  if (sentinel) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMorePosts();
    }, { threshold: 0.5 });
    observer.observe(sentinel);
  }

  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

  document.addEventListener('click', async (e) => {
    const targetBtn = e.target.closest('button');
    if (targetBtn) {
      if (!state.currentUser) {
        if (targetBtn.classList.contains('like-btn') || targetBtn.classList.contains('save-btn') || targetBtn.classList.contains('follow-btn-post')) {
          showToast('Увійдіть, щоб виконати цю дію');
          return;
        }
      }
      if (targetBtn.classList.contains('like-btn')) {
        const postId = targetBtn.dataset.postId;
        const { toggleLike } = await import('./posts.js');
        toggleLike(postId, targetBtn);
      }
      if (targetBtn.classList.contains('save-btn')) {
        const postId = targetBtn.dataset.postId;
        const { toggleSave } = await import('./posts.js');
        toggleSave(postId, targetBtn);
      }
    }
    const uidElement = e.target.closest('[data-uid]');
    if (uidElement) {
      const uid = uidElement.dataset.uid;
      viewProfile(uid);
    }
  });
});

onAuthStateChanged(auth, (user) => {
  // Очищуємо попередній інтервал онлайн при зміні стану авторизації
  if (state.onlineInterval) {
    clearInterval(state.onlineInterval);
    state.onlineInterval = null;
  }

  cleanupAllListeners();

  if (user) {
    setCurrentUser(user);
    const authBox = document.getElementById('authBox');
    if (authBox) authBox.style.display = 'none';
    const newPostBox = document.getElementById('newPostBox');
    if (newPostBox) newPostBox.style.display = 'block';

    // Оновлення lastOnline одразу при вході + кожні 45 секунд
    updateLastOnline();
    const onlineInterval = setInterval(updateLastOnline, 45000);
    state.onlineInterval = onlineInterval;

    // Зберігаємо також стандартний інтервал через setLastOnlineInterval (для cleanupAllListeners)
    const interval = setInterval(updateLastOnline, 30000);
    setLastOnlineInterval(interval);

    const userRef = doc(db, "users", user.uid);
    const unsubFollowing = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        setCurrentUserData(docSnap.data());
        if (docSnap.data().settings) {
          Object.assign(state.userSettings, docSnap.data().settings);
          if (state.userSettings.preferences.darkMode) {
            document.body.classList.add('dark');
          } else {
            document.body.classList.remove('dark');
          }
        }
        document.querySelectorAll('.follow-btn-post').forEach(btn => {
          const targetUid = btn.dataset.uid;
          if (targetUid) {
            const isFollowing = state.currentUserFollowing.includes(targetUid);
            btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
            btn.classList.toggle('following', isFollowing);
          }
        });
      }
    }, (error) => {
      console.error('Error in following snapshot:', error);
    });
    setUnsubscribeFollowing(unsubFollowing);

    const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
    const unsubChatList = onSnapshot(q, (snapshot) => {
      let totalUnread = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.unread && data.unread[user.uid]) {
          totalUnread += data.unread[user.uid];
        }
      });
      updateUnreadCount(totalUnread - state.unreadCount);
      updateUnreadBadge(state.unreadCount);
      if (document.getElementById('chats')?.classList.contains('active')) {
        loadChatList();
      }
    }, (error) => {
      console.error('Chat list snapshot error:', error);
      showToast('Помилка оновлення списку чатів.');
    });
    setUnsubscribeChatList(unsubChatList);

    resetPagination();
    import('./profile.js').then(module => module.loadMyProfile());
  } else {
    setCurrentUser(null);
    setCurrentUserData(null);
    const authBox = document.getElementById('authBox');
    if (authBox) authBox.style.display = 'block';
    const newPostBox = document.getElementById('newPostBox');
    if (newPostBox) newPostBox.style.display = 'none';
    updateUnreadBadge(0);
  }
});

async function loadSearchUsers() {
  if (!state.currentUser) return;
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
      const { renderPosts } = await import('./posts.js');
      renderPosts(snapshot.docs, feedDiv);
    }
    return;
  }

  const mySnap = await getDoc(doc(db, "users", state.currentUser.uid));
  const myFollowing = mySnap.data().following || [];

  const q1 = query(collection(db, "users"), where("userId", ">=", val.startsWith('@') ? val : `@${val}`), where("userId", "<=", (val.startsWith('@') ? val : `@${val}`) + '\uf8ff'));
  const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));

  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  const usersMap = new Map();
  snap1.forEach(d => usersMap.set(d.id, d.data()));
  snap2.forEach(d => usersMap.set(d.id, d.data()));

  userList.innerHTML = '';
  usersMap.forEach((data, uid) => {
    if (uid === state.currentUser.uid) return;
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

function resetPagination() {
  resetPaginationState();
  const feed = document.getElementById('feed');
  if (feed) {
    feed.innerHTML = '';
    loadMorePosts();
  }
}
