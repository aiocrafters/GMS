/* =====================================================================
 *  dashboard.js — Dashboard page behaviour
 * ===================================================================== */

(function () {
  'use strict';

  const dashboardEl = document.getElementById('dashboard');
  const logoutBtn   = document.getElementById('logout-btn');

  // ── Boot: verify session, then populate UI ──
  (async function init() {
    try {
      const { session, error } = await getSession();

      if (error || !session) {
        // Not authenticated — redirect to login
        window.location.replace('index.html');
        return;
      }

      const user = session.user;

      // Fetch profile from login_users table
      let profile = null;
      try {
        const result = await fetchUserProfile(user.id);
        if (!result.error && result.profile) {
          profile = result.profile;
        }
      } catch (_) { /* profile fetch failed — use auth data only */ }

      populateDashboard(user, session, profile);

      // Show the dashboard
      dashboardEl.style.display = 'flex';
      hideLoading();

    } catch (err) {
      console.error('Dashboard init error:', err);
      showToast('Unable to verify session. Redirecting…', 'error');
      setTimeout(() => window.location.replace('index.html'), 1500);
    }
  })();

  // ── Logout ──
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    try {
      await signOut();
      showToast('Signed out successfully.', 'success', 1500);
      setTimeout(() => window.location.replace('index.html'), 600);
    } catch (err) {
      showToast('Logout failed. Please try again.', 'error');
      logoutBtn.disabled = false;
    }
  });

  // ── Listen for auth state changes (e.g. token refresh, sign-out in another tab) ──
  try {
    const client = getSupabaseClient();
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        window.location.replace('index.html');
      }
    });
  } catch (_) { /* ignore */ }


  /* ===================================================================
   *  Populate Dashboard UI
   * =================================================================== */
  function populateDashboard(user, session, profile) {

    // ── Determine display values ──
    const name        = profile?.name || user.user_metadata?.name || user.email?.split('@')[0] || 'User';
    const email       = profile?.email || user.email || '—';
    const role        = profile?.role || 'Authenticated';
    const designation = profile?.designation || '—';
    const department  = profile?.department || '—';
    const section     = profile?.department_section || '—';
    const address     = profile?.department_address || '—';
    const status      = profile?.status || 'active';
    const lastLogin   = profile?.last_login
      ? formatDate(profile.last_login)
      : user.last_sign_in_at
        ? formatDate(user.last_sign_in_at)
        : 'First login';
    const initials    = getInitials(name);

    // ── Nav ──
    setText('nav-avatar', initials);
    setText('nav-user-name', name);
    setText('nav-user-role', role);

    // ── Greeting ──
    setText('greeting-name', name.split(' ')[0]);

    const hour = new Date().getHours();
    let greetWord = 'Good evening';
    if (hour < 12) greetWord = 'Good morning';
    else if (hour < 17) greetWord = 'Good afternoon';
    setText('greeting-subtitle', `${greetWord}! Here's an overview of your account.`);

    // ── Stat cards ──
    setText('stat-role', role);
    setText('stat-status', capitalise(status));
    setText('stat-dept', department);
    setText('stat-last-login', lastLogin);

    // ── Profile fields ──
    setText('profile-name', name);
    setText('profile-email', email);
    setText('profile-designation', designation);
    setText('profile-department', department);
    setText('profile-section', section);
    setText('profile-address', address);

    // Role badge
    const roleEl = document.getElementById('profile-role');
    if (roleEl) {
      const badgeClass = role === 'Admin' ? 'badge-warning' : role === 'Viewer' ? 'badge-primary' : 'badge-success';
      roleEl.innerHTML = `<span class="badge ${badgeClass}">${escapeHtml(role)}</span>`;
    }

    // Status badge
    const statusEl = document.getElementById('profile-status');
    if (statusEl) {
      const sClass = status === 'active' ? 'badge-success' : 'badge-warning';
      statusEl.innerHTML = `<span class="badge ${sClass}">${capitalise(status)}</span>`;
    }

    // ── Session fields ──
    setText('session-uid', user.id);
    setText('session-provider', user.app_metadata?.provider || 'email');
    setText('session-created', user.created_at ? formatDate(user.created_at) : '—');
    setText('session-expires', session.expires_at ? formatDate(new Date(session.expires_at * 1000).toISOString()) : '—');

    // ── Update last_login in the database (fire and forget) ──
    updateLastLogin(user.id);
  }


  /* ===================================================================
   *  Helper Functions
   * =================================================================== */

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function getInitials(name) {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  function capitalise(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (_) {
      return iso;
    }
  }

  /**
   * Fire-and-forget update to login_users.last_login.
   * Uses the authenticated user's RLS policy (UPDATE where auth.uid() = id).
   */
  async function updateLastLogin(userId) {
    try {
      const client = getSupabaseClient();
      await client
        .from('login_users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', userId);
    } catch (_) { /* non-critical */ }
  }

})();
