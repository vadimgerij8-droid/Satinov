import { db, storage } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { showToast, setupFileInput, updateFocusableCache, setFocusOnElement } from './helpers.js';
import { renderPosts, toggleFollow, updateFollowing } from './feed.js';

let currentUser = null;
let currentProfileUid = null;

export function initProfile(user) {
  currentUser = user;
  currentProfileUid = user.uid;

  // Обробник для кнопки "Редагувати профіль"
  document.getElementById('saveProfileEdit').onclick = saveProfileEdit;
  document.getElementById('closeModal').onclick = () => {
    document.getElementById('editProfileModal').classList.remove('active');
    setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(document.querySelector('.nav-item.active')); }, 50);
  };

  // Налаштування файлового інпуту для аватара
  setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');

  // Закриття модалок підписників/підписок
  document.getElementById('closeFollowersModal').onclick = () => {
    document.getElementById('followersModal').classList.remove('active');
    setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(document.querySelector('.nav-item.active')); }, 50);
  };
  document.getElementById('closeFollowingModal').onclick = () => {
    document.getElementById('followingModal').classList.remove('active');
    setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(document.querySelector('.nav-item.active')); }, 50);
  };
}

export function viewProfile(uid) {
  currentProfileUid = uid;
  // Перемикання розділу буде в app.js
  if (uid === currentUser?.uid) {
    loadMyProfile();
  } else {
    loadUserProfile(uid);
  }
}

async function loadMyProfile() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists()) renderProfile(snap.data(), currentUser.uid, true);
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
        // Оновлюємо список following в feed (через глобальну змінну)
        const userSnap = await getDoc(doc(db, "users", currentUser.uid));
        updateFollowing(userSnap.data().following || []);
      };
    }
    const profileMessageBtn = document.getElementById('profileMessageBtn');
    if (profileMessageBtn) {
      profileMessageBtn.onclick = () => {
        // Виклик відкриття чату з іншого модуля
        if (window.openChat) window.openChat(data.nickname, uid, data.userId);
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
            if (window.updateFocusableCache) window.updateFocusableCache(); 
            const firstItem = dropdown.querySelector('.profile-menu-item');
            if (firstItem && window.setFocusOnElement) window.setFocusOnElement(firstItem);
          }, 50);
        } else {
          setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(menuBtn); }, 50);
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
        setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(document.getElementById('editNickname')); }, 50);
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
  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); }, 100);
}

async function openFollowersList(uid) {
  const modal = document.getElementById('followersModal');
  const list = document.getElementById('followersList');
  if (!modal || !list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  modal.classList.add('active');

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
  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(list.firstChild); }, 100);
}

async function openFollowingList(uid) {
  const modal = document.getElementById('followingModal');
  const list = document.getElementById('followingList');
  if (!modal || !list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  modal.classList.add('active');

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
  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(list.firstChild); }, 100);
}

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

  // Використовуємо функцію renderPosts з feed.js
  renderPosts(posts.map(p => ({ id: p.id, data: () => p })), feed);
}

async function saveProfileEdit() {
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
}

// Функції для скарг, мюту, блокування
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

// Експортуємо для використання в app.js
export { loadMyProfile, loadUserProfile };
