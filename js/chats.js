import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, increment, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { showToast, getChatId, formatMessageTime, formatMessageDate, updateFocusableCache, setFocusOnElement, setupEmojiPicker } from './helpers.js';

let currentUser = null;
let currentChatPartner = null;
let currentChatPartnerName = '';
let currentChatId = null;
let unsubscribeChat = null;
let unsubscribeTyping = null;
let unsubscribeOnlineStatus = null;

export function initChats(user) {
  currentUser = user;

  // Обробники подій для чату
  document.getElementById('sendMessage').onclick = sendMessage;
  document.getElementById('chatText').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('sendMessage').click();
    }
  });

  // Відстеження набору тексту
  document.getElementById('chatText').addEventListener('input', handleTyping);

  // Пошук користувачів
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

  // Емоджі пікер для чату
  setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');
}

export function loadChatList() {
  if (!currentUser) return;
  const list = document.getElementById('chatList');
  if (!list) return;
  list.innerHTML = '';

  const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
  onSnapshot(q, async (snapshot) => {
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

    list.innerHTML = '';
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
    setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); }, 100);
  }, (error) => {
    console.error('Error loading chat list:', error);
    showToast('Помилка завантаження списку чатів.');
  });
}

function openChatFromList(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  if (!currentUser) return;
  currentChatPartner = otherUid;
  currentChatPartnerName = otherName;
  currentChatId = chatId;

  const chatWindow = document.getElementById('chatWindow');
  if (chatWindow) chatWindow.style.display = 'flex';
  document.getElementById('chatName').textContent = otherName;
  document.getElementById('chatUserId').textContent = otherUserId || '';
  document.getElementById('chatAvatar').style.backgroundImage = `url(${otherAvatar || ''})`;

  const chatRef = doc(db, "chats", chatId);
  updateDoc(chatRef, { [`unread.${currentUser.uid}`]: 0 }).catch(console.error);

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

  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(document.getElementById('chatText')); }, 200);
}

export function openChat(otherName, otherUid, otherUserId) {
  if (!currentUser) return;
  currentChatPartner = otherUid;
  currentChatPartnerName = otherName;

  // Перемикання на розділ чатів буде в app.js

  const chatWindow = document.getElementById('chatWindow');
  if (chatWindow) chatWindow.style.display = 'flex';
  document.getElementById('chatName').textContent = otherName;
  document.getElementById('chatUserId').textContent = otherUserId || '';

  getDoc(doc(db, "users", otherUid)).then(snap => {
    if (snap.exists()) {
      document.getElementById('chatAvatar').style.backgroundImage = `url(${snap.data().avatar || ''})`;
      const lastOnline = snap.data().lastOnline?.seconds || 0;
      const isOnline = (Date.now()/1000 - lastOnline) < 60;
      document.getElementById('onlineIndicator').style.display = isOnline ? 'inline-block' : 'none';
    }
  }).catch(console.error);

  if (unsubscribeOnlineStatus) unsubscribeOnlineStatus();
  unsubscribeOnlineStatus = onSnapshot(doc(db, "users", otherUid), (snap) => {
    const lastOnline = snap.data()?.lastOnline?.seconds || 0;
    const isOnline = (Date.now()/1000 - lastOnline) < 60;
    document.getElementById('onlineIndicator').style.display = isOnline ? 'inline-block' : 'none';
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
      showToast('Помилка відкриття чату');
    }
  }).catch(error => {
    console.error('Error getting chat doc:', error);
    showToast('Помилка доступу до чату');
  });

  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); setFocusOnElement?.(document.getElementById('chatText')); }, 200);
}

async function subscribeToChat(chatId) {
  if (!currentUser) throw new Error('No current user');
  if (unsubscribeChat) unsubscribeChat();
  if (unsubscribeTyping) unsubscribeTyping();

  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) throw new Error('chatMessages container not found');

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

async function sendMessage() {
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
    showToast('Помилка відправлення повідомлення');
  }
}

let typingTimeout;
function handleTyping() {
  if (!currentUser || !currentChatPartner || !currentChatId) return;
  const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
  setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error), 2000);
}

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
  setTimeout(() => { if (window.updateFocusableCache) window.updateFocusableCache(); }, 100);
}

// Для очищення підписок
export function cleanupChatListeners() {
  if (unsubscribeChat) unsubscribeChat();
  if (unsubscribeTyping) unsubscribeTyping();
  if (unsubscribeOnlineStatus) unsubscribeOnlineStatus();
}
