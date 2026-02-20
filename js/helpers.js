// Допоміжні функції
export const showToast = (msg) => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
};

export const vibrate = (ms) => {
  if (navigator.vibrate) navigator.vibrate(ms);
};

export const updateUnreadBadge = (unreadCount) => {
  const badge = document.getElementById('unreadBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
};

export const emojiList = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'
];

export function closeAllEmojiPickers() {
  document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
}

export function setupEmojiPicker(buttonId, pickerId, inputId) {
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
        updateFocusableCache?.(); // defined in tv-navigation
        const firstEmoji = picker.querySelector('button');
        if (firstEmoji) setFocusOnElement?.(firstEmoji);
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
      updateFocusableCache?.();
      setFocusOnElement?.(input);
    });
    picker.appendChild(button);
  });

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== btn) {
      picker.style.display = 'none';
    }
  });
}

export function setupFileInput(inputId, labelId, previewId) {
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

export function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

export const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

export function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatMessageDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Сьогодні';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
  return date.toLocaleDateString();
}
