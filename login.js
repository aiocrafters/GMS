/* =====================================================================
 *  login.js — Login page behaviour
 * ===================================================================== */

(function () {
  'use strict';

  // ── DOM refs ──
  const form        = document.getElementById('login-form');
  const emailInput  = document.getElementById('email');
  const passInput   = document.getElementById('password');
  const loginBtn    = document.getElementById('login-btn');
  const emailErr    = document.getElementById('email-error');
  const passErr     = document.getElementById('password-error');
  const toggleBtn   = document.getElementById('toggle-password');
  const eyeOpen     = document.getElementById('eye-open');
  const eyeClosed   = document.getElementById('eye-closed');

  // ── On load: if already authenticated → redirect to dashboard ──
  (async function checkExistingSession() {
    try {
      const { session } = await getSession();
      if (session) {
        window.location.replace('dashboard.html');
        return;
      }
    } catch (_) { /* ignore – let user see login */ }
    hideLoading();
  })();

  // ── Toggle password visibility ──
  toggleBtn.addEventListener('click', () => {
    const showing = passInput.type === 'text';
    passInput.type = showing ? 'password' : 'text';
    eyeOpen.style.display   = showing ? 'block' : 'none';
    eyeClosed.style.display = showing ? 'none'  : 'block';
  });

  // ── Real-time field validation reset ──
  emailInput.addEventListener('input', () => {
    emailInput.classList.remove('invalid');
    emailErr.classList.remove('visible');
  });
  passInput.addEventListener('input', () => {
    passInput.classList.remove('invalid');
    passErr.classList.remove('visible');
  });

  // ── Form submission ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Client-side validation
    let valid = true;

    const email = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.classList.add('invalid');
      emailErr.classList.add('visible');
      valid = false;
    }

    if (!password || password.length < 6) {
      passInput.classList.add('invalid');
      passErr.classList.add('visible');
      valid = false;
    }

    if (!valid) return;

    // Disable UI & show spinner
    setLoading(true);

    try {
      const { user, error } = await signIn(email, password);

      if (error) {
        const msg = friendlyAuthError(error);
        showToast(msg, 'error');
        setLoading(false);
        return;
      }

      showToast('Signed in successfully! Redirecting…', 'success', 2000);

      // Short delay so user sees the success toast
      setTimeout(() => {
        window.location.replace('dashboard.html');
      }, 600);

    } catch (err) {
      showToast('An unexpected error occurred. Please try again.', 'error');
      setLoading(false);
    }
  });

  // ── Helpers ──

  function setLoading(on) {
    loginBtn.disabled = on;
    loginBtn.classList.toggle('loading', on);
  }

  function friendlyAuthError(error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
      return 'Incorrect email or password. Please try again.';
    }
    if (msg.includes('email not confirmed')) {
      return 'Please confirm your email address before signing in.';
    }
    if (msg.includes('too many requests') || msg.includes('rate limit')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (msg.includes('user not found')) {
      return 'No account found with that email address.';
    }
    return error.message || 'Authentication failed. Please try again.';
  }
})();
