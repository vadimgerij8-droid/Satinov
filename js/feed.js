import { db, storage } from './firebase-config.js';
import { collection, query, where, orderBy, limit, startAfter, getDocs, getDoc, doc, setDoc, addDoc, updateDoc, deleteDoc, increment, arrayUnion, arrayRemove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { showToast, vibrate, extractHashtags, setupEmojiPicker, setupFileInput, updateFocusableCache, setFocusOnElement } from './helpers.js';

// Глобальні змінні стану стрічки (будуть ініціалізовані в app.js)
let currentFeedType = 'new';
let lastVisible = null;
let loading = false;
let hasMore = true;
let currentUser = null;
let currentUserFollowing = [];
let viewedPosts = new Set();

export function initFeed(user, following) {
  currentUser = user;
  currentUserFollowing = following;
  resetPagination();

  // Кнопки зміни типу стрічки
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

  // Додавання поста
  document.getElementById('addPost').onclick = addPost;

  // Налаштування емоджі та файлових інпутів
  setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
  setupFileInput('postMedia', 'postMediaLabel', 'postMediaPreview');
}

function resetPagination() {
  lastVisible = null;
  hasMore = true;
  const feed = document.getElementById('feed');
  if (feed) feed.innerHTML = '';
  loadMorePosts();
}

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
    setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); }, 100);
  }
}

async function addPost() {
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
        const targetUid = followBtn.dataset.uid;
        toggleFollow(targetUid, followBtn);
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
        setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); }, 100);
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
  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); }, 100);
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

// Функція для пошуку за хештегом (перекидає на search)
function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    document.querySelector('[data-section="search"]').click();
    // Потрібно викликати функцію пошуку, яка є в profile.js, тому ми її імпортуємо? 
    // Краще викликати через подію, але для простоти можна зробити глобальну функцію в window.
    if (window.loadSearchUsers) window.loadSearchUsers();
  }
}

export function updateFollowing(newFollowing) {
  currentUserFollowing = newFollowing;
}

export function setCurrentUser(user) {
  currentUser = user;
}

// Експортуємо деякі функції для зовнішнього використання
export { loadMorePosts, renderPosts, toggleFollow };
