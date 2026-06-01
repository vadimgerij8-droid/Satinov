import { db } from './config.js';
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, query, where, 
  orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { 
  state, setCurrentChat, clearChatState, setReplyContext, clearReplyContext,
  setUnsubscribeMessages, setUnsubscribeTyping, setUnsubscribeChatPresence,
  updateUnreadCount
} from './state.js';
import { showToast, uploadToCloudinary, formatLastSeen } from './utils.js';
import { viewProfile, blockUser } from './profile.js';

export const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

// ─── Typing timeout ───────────────────────────────────────────────────────────
let typingTimeout;

// ─── handleTyping (export для main.js) ───────────────────────────────────────
export async function handleTyping() {
  if (!state.currentUser || !state.currentChatId || !state.currentChatPartner) return;

  const typingRef = doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`);

  try {
    const input = document.getElementById('chatText');
    const hasText = input && input.value.trim().length > 0;

    if (hasText) {
      await setDoc(typingRef, { isTyping: true, timestamp: serverTimestamp() }, { merge: true });

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(async () => {
        await setDoc(typingRef, { isTyping: false, timestamp: serverTimestamp() }, { merge: true });
      }, 2000);
    } else {
      clearTimeout(typingTimeout);
      await setDoc(typingRef, { isTyping: false, timestamp: serverTimestamp() }, { merge: true });
    }
  } catch (error) {
    console.error("Помилка оновлення статусу друку:", error);
  }
}

// ─── loadChatList ─────────────────────────────────────────────────────────────
export async function loadChatList() {
  if (!state.currentUser) return;
  const listEl = document.getElementById('chatList');
  if (!listEl) return;

  try {
    const snapshot = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", state.currentUser.uid)));
    const chatItems = [];

    for (const docSnap of snapshot.docs) {
      const chat = docSnap.data();
      const otherUid = chat.participants.find(uid => uid !== state.currentUser.uid);
      if (!otherUid) continue;

      const userSnap = await getDoc(doc(db, "users", otherUid));
      if (!userSnap.exists()) continue;
      const user = userSnap.data();

      const unread = chat.unread?.[state.currentUser.uid] || 0;
      const lastMsg = chat.lastMessage || '';
      const lastMsgType = chat.lastMessageType || 'text';
      let displayLast = lastMsg;
      if (lastMsgType === 'photo') displayLast = '📷 Фото';
      else if (lastMsgType === 'video') displayLast = '🎥 Відео';

      const updatedAt = chat.updatedAt?.seconds * 1000 || 0;
      const time = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      const lastOnline = user.lastOnline?.seconds * 1000 || 0;
      const isOnline = (Date.now() - lastOnline) < 60000;

      chatItems.push({
        chatId: docSnap.id,
        otherUid,
        user,
        unread,
        lastMsg: displayLast,
        time,
        isOnline,
        updatedAt
      });
    }

    chatItems.sort((a, b) => b.updatedAt - a.updatedAt);
    renderChatList(chatItems);
  } catch (error) {
    console.error('Помилка завантаження списку чатів:', error);
    showToast('Не вдалося завантажити чати');
  }
}

function renderChatList(chatItems) {
  const listEl = document.getElementById('chatList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (chatItems.length === 0) {
    listEl.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
    return;
  }

  chatItems.forEach(item => {
    const div = document.createElement('div');
    div.className = `chat-item ${item.unread > 0 ? 'unread' : ''}`;
    div.dataset.chatId = item.chatId;
    div.dataset.otherUid = item.otherUid;
    div.tabIndex = 0;

    div.innerHTML = `
      <div class="chat-avatar">
        <div class="avatar small" style="background-image:url(${item.user.avatar || ''})"></div>
        ${item.isOnline ? '<span class="online-indicator"></span>' : ''}
        ${item.user.note ? `<div class="note-badge">${item.user.note}</div>` : ''}
      </div>
      <div class="chat-info">
        <div class="chat-name">${item.user.nickname}</div>
        <div class="chat-last">${item.lastMsg}</div>
      </div>
      <div class="chat-time">${item.time}</div>
      ${item.unread > 0 ? `<div class="chat-badge">${item.unread}</div>` : ''}
    `;

    div.addEventListener('click', () => {
      openChat(item.chatId, item.otherUid, item.user.nickname, item.user.userId, item.user.avatar);
    });

    listEl.appendChild(div);
  });
}

// ─── openChat ─────────────────────────────────────────────────────────────────
export async function openChat(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  if (!state.currentUser) return;

  setCurrentChat(chatId, otherUid, otherName, otherUserId, otherAvatar);

  document.getElementById('chatName').textContent = otherName;
  document.getElementById('chatStatus').textContent = '';
  const avatarEl = document.getElementById('chatAvatar');
  avatarEl.style.backgroundImage = `url(${otherAvatar || ''})`;

  const chatWindowContainer = document.getElementById('chatWindowContainer');
  chatWindowContainer.style.display = 'flex';
  if (window.innerWidth < 768) {
    document.getElementById('chatListSidebar').classList.add('hide');
  }

  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.classList.add('hide-chat-mode');
  }

  const chatRef = doc(db, "chats", chatId);
  await updateDoc(chatRef, {
    [`unread.${state.currentUser.uid}`]: 0
  }).catch(console.error);

  subscribeToMessages(chatId);

  // ── Підписка на статус партнера (онлайн / час) ────────────────────────────
  if (state.unsubscribeChatPresence) state.unsubscribeChatPresence();
  const partnerRef = doc(db, "users", otherUid);
  const unsubPresence = onSnapshot(partnerRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      const statusEl = document.getElementById('chatStatus');
      if (statusEl) {
        const lastOnline = data.lastOnline?.seconds * 1000 || 0;
        const isOnline = (Date.now() - lastOnline) < 60000;

        if (isOnline) {
          statusEl.textContent = 'Активний(а) зараз';
          statusEl.className = 'chat-status online';
          statusEl.style.color = '#4ade80';
        } else {
          statusEl.textContent = formatLastSeen(data.lastOnline);
          statusEl.className = 'chat-status';
          statusEl.style.color = 'rgba(255,255,255,0.5)';
        }
      }
    }
  });
  setUnsubscribeChatPresence(unsubPresence);

  // ── Підписка на typing ────────────────────────────────────────────────────
  if (state.unsubscribeTyping) state.unsubscribeTyping();
  const typingRef = doc(db, `chats/${chatId}/typing/${otherUid}`);
  const unsubTyping = onSnapshot(typingRef, (docSnap) => {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) return;
    if (docSnap.exists() && docSnap.data().isTyping) {
      indicator.style.display = 'flex';
    } else {
      indicator.style.display = 'none';
    }
  });
  setUnsubscribeTyping(unsubTyping);

  setTimeout(() => document.getElementById('chatText')?.focus(), 200);
}

// ─── subscribeToMessages ──────────────────────────────────────────────────────
function subscribeToMessages(chatId) {
  if (!state.currentUser) return;
  if (state.unsubscribeMessages) state.unsubscribeMessages();

  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.innerHTML = '';

  const q = query(collection(db, `chats/${chatId}/messages`), orderBy("createdAt", "asc"));
  const unsub = onSnapshot(q, (snapshot) => {
    let lastDate = '';
    messagesContainer.innerHTML = '';

    snapshot.forEach(docSnap => {
      const msg = { id: docSnap.id, ...docSnap.data() };
      const msgDate = formatMessageDate(msg.createdAt);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = msgDate;
        messagesContainer.appendChild(divider);
      }

      const messageEl = createMessageElement(msg);
      messagesContainer.appendChild(messageEl);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, (error) => {
    console.error('Помилка отримання повідомлень:', error);
    showToast('Помилка завантаження повідомлень');
  });
  setUnsubscribeMessages(unsub);
}

// ─── createMessageElement ─────────────────────────────────────────────────────
function createMessageElement(msg) {
  const isMine = msg.from === state.currentUser.uid;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMine ? 'sent' : 'received'}`;
  wrapper.dataset.messageId = msg.id;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMine ? 'sent' : 'received'}`;

  if (msg.replyTo) {
    const replyPreview = document.createElement('div');
    replyPreview.className = 'message-reply-preview';
    replyPreview.setAttribute('data-reply-to', msg.replyTo.messageId);
    replyPreview.innerHTML = `
      <div class="reply-sender">${msg.replyTo.senderName}</div>
      <div class="reply-text">${msg.replyTo.text}</div>
    `;
    replyPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      const originalMsg = document.querySelector(`.message-wrapper[data-message-id="${msg.replyTo.messageId}"]`);
      if (originalMsg) {
        originalMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        originalMsg.classList.add('focused-animated');
        setTimeout(() => originalMsg.classList.remove('focused-animated'), 2000);
      }
    });
    bubble.appendChild(replyPreview);
  }

  if (!isMine) {
    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender';
    senderDiv.innerHTML = `
      <div class="message-sender-avatar" style="background-image:url(${state.currentChatPartnerAvatar || ''})"></div>
      <span>${state.currentChatPartnerName}</span>
    `;
    bubble.appendChild(senderDiv);
  }

  if (msg.text) {
    const textDiv = document.createElement('div');
    textDiv.className = `message-text ${msg.edited ? 'edited' : ''}`;
    textDiv.textContent = msg.text;
    bubble.appendChild(textDiv);
  }

  if (msg.mediaUrl) {
    const mediaEl = msg.mediaType === 'image' ? document.createElement('img') : document.createElement('video');
    mediaEl.src = msg.mediaUrl;
    mediaEl.className = 'message-media';
    if (msg.mediaType === 'video') mediaEl.controls = true;
    mediaEl.addEventListener('click', () => window.open(msg.mediaUrl, '_blank'));
    bubble.appendChild(mediaEl);
  }

  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    const reactionsDiv = document.createElement('div');
    reactionsDiv.className = 'message-reactions';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      if (users.length === 0) continue;
      const reactionItem = document.createElement('span');
      reactionItem.className = `reaction-item ${users.includes(state.currentUser.uid) ? 'user-reacted' : ''}`;
      reactionItem.dataset.emoji = emoji;
      reactionItem.innerHTML = `<span class="emoji">${emoji}</span><span class="count">${users.length}</span>`;
      reactionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReaction(msg.id, emoji);
      });
      reactionsDiv.appendChild(reactionItem);
    }
    bubble.appendChild(reactionsDiv);
  }

  const footer = document.createElement('div');
  footer.className = 'message-footer';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = formatMessageTime(msg.createdAt);
  footer.appendChild(timeSpan);

  if (isMine) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'message-status';
    let status = 'sent';
    if (msg.readBy && msg.readBy.includes(state.currentChatPartner)) {
      status = 'read';
    } else if (msg.deliveredTo && msg.deliveredTo.includes(state.currentChatPartner)) {
      status = 'delivered';
    }
    statusSpan.innerHTML = getStatusIcon(status);
    footer.appendChild(statusSpan);
  }

  bubble.appendChild(footer);
  wrapper.appendChild(bubble);

  wrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, msg);
  });
  let longPressTimer;
  wrapper.addEventListener('touchstart', (e) => {
    longPressTimer = setTimeout(() => {
      showMessageContextMenu(e, msg);
    }, 500);
  });
  wrapper.addEventListener('touchend', () => clearTimeout(longPressTimer));
  wrapper.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  return wrapper;
}

function getStatusIcon(status) {
  const icons = {
    sent: '<svg class="status-icon sent" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
    delivered: '<svg class="status-icon delivered" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.68 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12z"/></svg>',
    read: '<svg class="status-icon read" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.68 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12z"/></svg>'
  };
  return icons[status] || icons.sent;
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
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

// ─── sendMessage ──────────────────────────────────────────────────────────────
export async function sendMessage(text, file) {
  if (!text && !file) return;
  if (!state.currentUser || !state.currentChatId || !state.currentChatPartner) {
    showToast('Чат не вибрано');
    return;
  }

  try {
    let mediaUrl = null;
    let mediaType = null;
    if (file) {
      mediaUrl = await uploadToCloudinary(file);
      mediaType = file.type.split('/')[0];
    }

    const messageData = {
      from: state.currentUser.uid,
      text: text || '',
      createdAt: serverTimestamp(),
      readBy: [state.currentUser.uid],
      deliveredTo: [state.currentUser.uid],
      reactions: {}
    };
    if (state.replyContext) {
      messageData.replyTo = {
        messageId: state.replyContext.messageId,
        text: state.replyContext.text,
        senderName: state.replyContext.senderName
      };
    }
    if (mediaUrl) {
      messageData.mediaUrl = mediaUrl;
      messageData.mediaType = mediaType;
    }

    const messageRef = collection(db, `chats/${state.currentChatId}/messages`);
    await addDoc(messageRef, messageData);

    const chatRef = doc(db, "chats", state.currentChatId);
    await updateDoc(chatRef, {
      lastMessage: text || (mediaType === 'image' ? '📷 Фото' : '🎥 Відео'),
      lastMessageType: mediaType || 'text',
      updatedAt: serverTimestamp(),
      [`unread.${state.currentChatPartner}`]: increment(1)
    });

    clearReplyContext();
    const preview = document.getElementById('replyPreview');
    if (preview) preview.remove();

    const textInput = document.getElementById('chatText');
    if (textInput) textInput.value = '';
    const fileInput = document.getElementById('chatAttachFile');
    if (fileInput) fileInput.value = '';
    const attachBtn = document.getElementById('chatAttachBtn');
    if (attachBtn) attachBtn.innerHTML = '📎';

    // Скидаємо typing після відправки
    const typingRef = doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`);
    await setDoc(typingRef, { isTyping: false }, { merge: true });
    clearTimeout(typingTimeout);
  } catch (error) {
    console.error('Помилка відправки:', error);
    showToast('Не вдалося відправити повідомлення');
  }
}

// ─── Context menu ─────────────────────────────────────────────────────────────
let selectedMessageId = null;

function showMessageContextMenu(event, msg) {
  event.preventDefault();
  selectedMessageId = msg.id;

  const menu = document.getElementById('messageContextMenu');
  if (!menu) return;
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.classList.add('show');

  const replyItem = menu.querySelector('[data-action="reply"]');
  const editItem = menu.querySelector('[data-action="edit"]');
  const deleteEveryoneItem = menu.querySelector('[data-action="deleteEveryone"]');

  if (msg.from === state.currentUser.uid) {
    if (editItem) editItem.style.display = 'block';
    if (deleteEveryoneItem) deleteEveryoneItem.style.display = 'block';
  } else {
    if (editItem) editItem.style.display = 'none';
    if (deleteEveryoneItem) deleteEveryoneItem.style.display = 'none';
  }
  if (replyItem) replyItem.style.display = 'block';

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('show');
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

export async function handleMessageContextAction(action) {
  if (!action || !selectedMessageId || !state.currentChatId) return;

  const messageRef = doc(db, `chats/${state.currentChatId}/messages/${selectedMessageId}`);
  const messageSnap = await getDoc(messageRef);
  const msgData = messageSnap.data();

  switch (action) {
    case 'reply':
      setReplyContext(selectedMessageId, msgData.text, msgData.from === state.currentUser.uid ? 'Ви' : state.currentChatPartnerName);
      document.getElementById('chatText').focus();
      break;
    case 'edit':
      const oldText = msgData.text;
      const newText = prompt('Редагувати повідомлення:', oldText);
      if (newText !== null) {
        await updateDoc(messageRef, { text: newText, edited: true });
      }
      break;
    case 'copy':
      if (msgData.text) {
        navigator.clipboard.writeText(msgData.text).then(() => showToast('Скопійовано'));
      }
      break;
    case 'deleteSelf':
      if (confirm('Видалити це повідомлення для себе?')) {
        showToast('Функція видалення для себе буде реалізована');
      }
      break;
    case 'deleteEveryone':
      if (confirm('Видалити це повідомлення для всіх?')) {
        await deleteDoc(messageRef);
      }
      break;
  }
  document.getElementById('messageContextMenu')?.classList.remove('show');
}

export async function toggleReaction(messageId, emoji) {
  if (!state.currentUser || !state.currentChatId) return;
  const messageRef = doc(db, `chats/${state.currentChatId}/messages/${messageId}`);
  const messageSnap = await getDoc(messageRef);
  if (!messageSnap.exists()) return;

  const reactions = messageSnap.data().reactions || {};
  const users = reactions[emoji] || [];
  const userIndex = users.indexOf(state.currentUser.uid);

  if (userIndex === -1) {
    users.push(state.currentUser.uid);
  } else {
    users.splice(userIndex, 1);
  }

  if (users.length === 0) {
    delete reactions[emoji];
  } else {
    reactions[emoji] = users;
  }

  await updateDoc(messageRef, { reactions });
}

// ─── searchUsersForChat ───────────────────────────────────────────────────────
export async function searchUsersForChat(queryStr) {
  if (!state.currentUser) return;

  const qLower = queryStr.toLowerCase();
  const resultsContainer = document.getElementById('chatSearchResults');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  resultsContainer.style.display = 'block';

  try {
    const searchTerm = qLower.startsWith('@') ? qLower : `@${qLower}`;
    const q1 = query(collection(db, "users"), where("userId", ">=", searchTerm), where("userId", "<=", searchTerm + '\uf8ff'));
    const q2 = query(collection(db, "users"), where("nickname_lower", ">=", qLower), where("nickname_lower", "<=", qLower + '\uf8ff'));

    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const usersMap = new Map();

    const blockedByMe = state.currentUserData?.blockedUsers || [];
    snap1.forEach(d => {
      if (d.id !== state.currentUser.uid && !blockedByMe.includes(d.id)) usersMap.set(d.id, d.data());
    });
    snap2.forEach(d => {
      if (d.id !== state.currentUser.uid && !blockedByMe.includes(d.id)) usersMap.set(d.id, d.data());
    });

    if (usersMap.size === 0) {
      resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Користувачів не знайдено</p>';
      return;
    }

    resultsContainer.innerHTML = '';
    usersMap.forEach((data, uid) => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.style.cursor = 'pointer';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="chat-avatar">
          <div class="avatar small" style="background-image:url(${data.avatar || ''})"></div>
          ${data.note ? `<div class="note-badge">${data.note}</div>` : ''}
        </div>
        <div class="chat-info">
          <div class="chat-name">${data.nickname}</div>
          <div class="chat-last">${data.userId}</div>
        </div>
        <button class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;">Написати</button>
      `;

      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        viewProfile(uid);
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        document.getElementById('chatSearchInput').value = '';
      });

      const btn = div.querySelector('button');
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chatId = getChatId(state.currentUser.uid, uid);
        const chatRef = doc(db, "chats", chatId);
        const chatSnap = await getDoc(chatRef);

        if (!chatSnap.exists()) {
          await setDoc(chatRef, {
            participants: [state.currentUser.uid, uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastMessage: '',
            unread: { [state.currentUser.uid]: 0, [uid]: 0 }
          });
        }

        openChat(chatId, uid, data.nickname, data.userId, data.avatar);
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        document.getElementById('chatSearchInput').value = '';
      });

      resultsContainer.appendChild(div);
    });
  } catch (error) {
    console.error('Помилка пошуку користувачів:', error);
    resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Помилка пошуку</p>';
  }
}

// ─── closeChat ────────────────────────────────────────────────────────────────
export function closeChat() {
  // Скидаємо typing-статус поточного користувача
  if (state.currentUser && state.currentChatId) {
    const typingRef = doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`);
    setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error);
  }
  clearTimeout(typingTimeout);

  // Приховуємо індикатор друку
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'none';

  const chatWindow = document.getElementById('chatWindowContainer');
  if (chatWindow) chatWindow.style.display = 'none';
  const chatSidebar = document.getElementById('chatListSidebar');
  if (chatSidebar) chatSidebar.classList.remove('hide');

  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.classList.remove('hide-chat-mode');
  }

  if (state.unsubscribeMessages) state.unsubscribeMessages();
  if (state.unsubscribeTyping) state.unsubscribeTyping();
  if (state.unsubscribeChatPresence) state.unsubscribeChatPresence();
  clearChatState();
}
