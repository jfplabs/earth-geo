/**
 * Toast Notifications — Earth Geo
 * Lightweight notification system. showToast(message, type) where type = 'success' | 'error' | 'info'
 */

const ICONS = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
};

const DURATION = 3000; // ms

/**
 * Show a toast notification at the bottom-right of the screen.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  // Auto-dismiss
  const timer = setTimeout(() => dismissToast(toast), DURATION);

  // Click to dismiss early
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(toast);
  });
}

function dismissToast(el) {
  el.classList.remove('toast-show');
  el.classList.add('toast-hide');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // Fallback removal if transition doesn't fire
  setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
