/**
 * Auth UI Component — Login/Signup modal
 * Uses the existing modal markup in index.html
 */

export class AuthUI {
  constructor(onAuthChange) {
    this.onAuthChange = onAuthChange || (() => {});
    this.user = null;
    this.bindEvents();
  }

  bindEvents() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    const overlay = modal.querySelector('.modal-overlay');
    const closeBtn = document.getElementById('auth-close');

    if (overlay) overlay.addEventListener('click', () => this.hide());
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

    // Toggle login/signup
    const showSignup = document.getElementById('show-signup');
    const showLogin = document.getElementById('show-login');

    if (showSignup) {
      showSignup.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('auth-login').classList.add('hidden');
        document.getElementById('auth-signup').classList.remove('hidden');
      });
    }

    if (showLogin) {
      showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('auth-signup').classList.add('hidden');
        document.getElementById('auth-login').classList.remove('hidden');
      });
    }

    // Login submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        try {
          errorEl.classList.add('hidden');
          const { default: api } = await import('../api.js');
          const data = await api.signIn(email, password);
          if (data.error) throw new Error(data.error);
          this.user = data.user;
          this.onAuthChange(data.user);
          this.hide();
        } catch (err) {
          errorEl.textContent = err.message || 'Login failed';
          errorEl.classList.remove('hidden');
        }
      });
    }

    // Signup submit
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const errorEl = document.getElementById('signup-error');

        try {
          errorEl.classList.add('hidden');
          const { default: api } = await import('../api.js');
          const data = await api.signUp(email, password, username);
          if (data.error) throw new Error(data.error);
          this.user = data.user;
          this.onAuthChange(data.user);
          this.hide();
        } catch (err) {
          errorEl.textContent = err.message || 'Signup failed';
          errorEl.classList.remove('hidden');
        }
      });
    }
  }

  show(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    if (mode === 'signup') {
      document.getElementById('auth-login')?.classList.add('hidden');
      document.getElementById('auth-signup')?.classList.remove('hidden');
    } else {
      document.getElementById('auth-signup')?.classList.add('hidden');
      document.getElementById('auth-login')?.classList.remove('hidden');
    }
  }

  hide() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
  }

  getUser() {
    return this.user;
  }

  isAuthenticated() {
    return !!this.user;
  }

  signOut() {
    this.user = null;
    this.onAuthChange(null);
  }
}
