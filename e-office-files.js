/* =====================================================================
 *  e-office-files.js — E-Office Files page behaviour
 *  Handles CRUD operations, Active / Archive lists, search, pagination.
 * ===================================================================== */

(function () {
  'use strict';

  /* ── Constants ── */
  const PAGE_SIZE = 20;

  /* ── State ── */
  let currentUser = null;
  let currentProfile = null;
  let currentView = 'active';        // 'active' | 'archive'
  let allActiveRecords = [];         // records with is_deleted === false
  let allArchivedRecords = [];       // records with is_deleted === true
  let filteredRecords = [];          // search-filtered subset of active view
  let currentPage = 1;
  let isEditMode = false;
  let modalTarget = null;            // uuid of target record
  let modalAction = 'delete';        // 'delete' | 'restore'

  /* ── DOM refs ── */
  const pageShell       = document.getElementById('page-shell');
  const logoutBtn       = document.getElementById('logout-btn');

  // Tabs & headers
  const tabActive       = document.getElementById('tab-active');
  const tabArchive      = document.getElementById('tab-archive');
  const activeBadge     = document.getElementById('active-badge');
  const archiveBadge    = document.getElementById('archive-badge');
  const tableTitleText  = document.getElementById('table-title-text');
  const colHeaderDate   = document.getElementById('col-header-date');
  const colHeaderUser   = document.getElementById('col-header-user');

  // Form elements
  const form            = document.getElementById('efile-form');
  const editUuidInput   = document.getElementById('edit-uuid');
  const compNumInput    = document.getElementById('computer-number');
  const fileNumInput    = document.getElementById('file-number');
  const subjectInput    = document.getElementById('file-subject');
  const compNumErr      = document.getElementById('computer-number-error');
  const fileNumErr      = document.getElementById('file-number-error');
  const submitBtn       = document.getElementById('submit-btn');
  const submitBtnText   = document.getElementById('submit-btn-text');
  const cancelBtn       = document.getElementById('cancel-btn');
  const formTitle       = document.getElementById('form-title-text');

  // Table & Toolbar
  const searchInput     = document.getElementById('search-input');
  const refreshBtn      = document.getElementById('refresh-btn');
  const tableBody       = document.getElementById('table-body');
  const recordCountEl   = document.getElementById('record-count');
  const paginationEl    = document.getElementById('pagination');

  // Modal elements
  const actionModal     = document.getElementById('delete-modal');
  const modalIcon       = document.getElementById('modal-icon');
  const modalTitleText  = document.getElementById('modal-title-text');
  const modalMsg        = document.getElementById('modal-message');
  const modalCancelBtn  = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');
  const modalConfirmText= document.getElementById('modal-confirm-text');


  /* ═════════════════════════════════════════════════════════════════════
   *  INIT — Auth check → populate nav → setup listeners → load data
   * ═════════════════════════════════════════════════════════════════════ */
  (async function init() {
    try {
      const { session, error } = await getSession();
      if (error || !session) {
        window.location.replace('index.html');
        return;
      }

      currentUser = session.user;

      // Fetch profile for nav display
      try {
        const res = await fetchUserProfile(currentUser.id);
        if (!res.error && res.profile) currentProfile = res.profile;
      } catch (_) { /* use auth data */ }

      populateNav();
      setupTabListeners();
      pageShell.style.display = 'flex';
      hideLoading();

      await loadRecords();

    } catch (err) {
      console.error('Init error:', err);
      showToast('Unable to verify session. Redirecting…', 'error');
      setTimeout(() => window.location.replace('index.html'), 1500);
    }
  })();


  /* ── Auth state listener ── */
  try {
    const client = getSupabaseClient();
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') window.location.replace('index.html');
    });
  } catch (_) { /* ignore */ }


  /* ═════════════════════════════════════════════════════════════════════
   *  NAV + LOGOUT
   * ═════════════════════════════════════════════════════════════════════ */
  function populateNav() {
    const name = currentProfile?.name || currentUser.email?.split('@')[0] || 'User';
    const role = currentProfile?.role || 'Authenticated';
    setText('nav-avatar', getInitials(name));
    setText('nav-user-name', name);
    setText('nav-user-role', role);
  }

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    try {
      await signOut();
      showToast('Signed out.', 'success', 1500);
      setTimeout(() => window.location.replace('index.html'), 600);
    } catch (_) {
      showToast('Logout failed.', 'error');
      logoutBtn.disabled = false;
    }
  });


  /* ═════════════════════════════════════════════════════════════════════
   *  TAB SWITCHING — Active List vs Archive List
   * ═════════════════════════════════════════════════════════════════════ */
  function setupTabListeners() {
    if (tabActive) {
      tabActive.addEventListener('click', () => switchView('active'));
    }
    if (tabArchive) {
      tabArchive.addEventListener('click', () => switchView('archive'));
    }
  }

  function switchView(view) {
    if (currentView === view) return;
    currentView = view;

    if (view === 'active') {
      tabActive.classList.add('active');
      tabActive.setAttribute('aria-selected', 'true');
      tabArchive.classList.remove('active');
      tabArchive.setAttribute('aria-selected', 'false');

      if (tableTitleText) tableTitleText.textContent = 'Active Records';
      if (colHeaderDate) colHeaderDate.textContent = 'Created At';
      if (colHeaderUser) colHeaderUser.textContent = 'Created By';
    } else {
      tabArchive.classList.add('active');
      tabArchive.setAttribute('aria-selected', 'true');
      tabActive.classList.remove('active');
      tabActive.setAttribute('aria-selected', 'false');

      if (tableTitleText) tableTitleText.textContent = 'Archived Records';
      if (colHeaderDate) colHeaderDate.textContent = 'Archived At';
      if (colHeaderUser) colHeaderUser.textContent = 'Archived By';
    }

    currentPage = 1;
    applySearchFilter();
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM — Create / Edit
   * ═════════════════════════════════════════════════════════════════════ */

  // Real-time validation reset
  compNumInput.addEventListener('input', () => {
    compNumInput.classList.remove('invalid');
    compNumErr.classList.remove('visible');
  });
  fileNumInput.addEventListener('input', () => {
    fileNumInput.classList.remove('invalid');
    fileNumErr.classList.remove('visible');
  });

  // Cancel button
  cancelBtn.addEventListener('click', resetForm);

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate
    let valid = true;
    const computerNumber = compNumInput.value.trim();
    const fileNumber     = fileNumInput.value.trim();
    const subject        = subjectInput.value.trim();

    if (!computerNumber) {
      compNumInput.classList.add('invalid');
      compNumErr.querySelector('span').textContent = 'Computer number is required';
      compNumErr.classList.add('visible');
      valid = false;
    }
    if (!fileNumber) {
      fileNumInput.classList.add('invalid');
      fileNumErr.querySelector('span').textContent = 'File number is required';
      fileNumErr.classList.add('visible');
      valid = false;
    }

    if (!valid) return;

    setFormLoading(true);

    const client = getSupabaseClient();
    const editUuid = editUuidInput.value;

    if (isEditMode && editUuid) {
      /* ── UPDATE ── */
      const payload = {
        e_office_computer_number: computerNumber,
        e_office_file_number: fileNumber,
        e_office_file_subject: subject || null
      };

      const { error } = await client
        .from('e_office_files')
        .update(payload)
        .eq('uuid', editUuid);

      if (error) {
        showToast(friendlyDbError(error, 'update'), 'error');
        setFormLoading(false);
        return;
      }

      showToast('Record updated successfully.', 'success');

    } else {
      /* ── INSERT ── */
      const payload = {
        e_office_computer_number: computerNumber,
        e_office_file_number: fileNumber,
        e_office_file_subject: subject || null,
        created_by: currentProfile?.email || currentUser.email || null,
        is_deleted: false
      };

      const { error } = await client
        .from('e_office_files')
        .insert(payload);

      if (error) {
        showToast(friendlyDbError(error, 'create'), 'error');
        setFormLoading(false);
        return;
      }

      showToast('Record created successfully.', 'success');
    }

    resetForm();
    setFormLoading(false);
    await loadRecords();
  });


  /* ═════════════════════════════════════════════════════════════════════
   *  DATA TABLE — Fetch, Render, Search, Paginate
   * ═════════════════════════════════════════════════════════════════════ */

  async function loadRecords() {
    renderTableLoading();
    refreshBtn.classList.add('spinning');

    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('e_office_files')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        showToast('Failed to load records: ' + error.message, 'error');
        renderTableEmpty('Error loading records.');
        refreshBtn.classList.remove('spinning');
        return;
      }

      const records = data || [];
      allActiveRecords = records.filter(r => !r.is_deleted);
      allArchivedRecords = records.filter(r => !!r.is_deleted);

      // Update badge counts
      if (activeBadge) activeBadge.textContent = allActiveRecords.length;
      if (archiveBadge) archiveBadge.textContent = allArchivedRecords.length;

      applySearchFilter();

    } catch (err) {
      showToast('Network error loading records.', 'error');
      renderTableEmpty('Network error.');
    }

    refreshBtn.classList.remove('spinning');
  }

  // Refresh button
  refreshBtn.addEventListener('click', () => loadRecords());

  // Search (debounced)
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      applySearchFilter();
    }, 250);
  });

  function applySearchFilter() {
    const sourceRecords = currentView === 'active' ? allActiveRecords : allArchivedRecords;
    const q = searchInput.value.trim().toLowerCase();

    if (!q) {
      filteredRecords = [...sourceRecords];
    } else {
      filteredRecords = sourceRecords.filter(r =>
        (r.e_office_computer_number || '').toLowerCase().includes(q) ||
        (r.e_office_file_number || '').toLowerCase().includes(q) ||
        (r.e_office_file_subject || '').toLowerCase().includes(q)
      );
    }

    // Clamp current page
    const maxPage = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
    if (currentPage > maxPage) currentPage = maxPage;

    renderTable();
    renderPagination();
    updateRecordCount(sourceRecords.length);
  }

  function renderTable() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = filteredRecords.slice(start, start + PAGE_SIZE);

    if (pageData.length === 0) {
      const msg = searchInput.value.trim()
        ? `No ${currentView === 'active' ? 'active' : 'archived'} records match your search.`
        : `No ${currentView === 'active' ? 'active' : 'archived'} records found.`;
      renderTableEmpty(msg);
      return;
    }

    tableBody.innerHTML = pageData.map((r, i) => {
      const sno = start + i + 1;
      const compNum  = escapeHtml(r.e_office_computer_number || '');
      const fileNum  = escapeHtml(r.e_office_file_number || '');
      const subject  = escapeHtml(r.e_office_file_subject || '—');

      // Date & User columns depend on active vs archive view
      const dateVal = currentView === 'active'
        ? (r.created_at ? formatDate(r.created_at) : '—')
        : (r.deleted_at ? formatDate(r.deleted_at) : '—');

      const userVal = currentView === 'active'
        ? escapeHtml(r.created_by || '—')
        : escapeHtml(r.deleted_by || '—');

      // Action buttons: Edit & Delete for active, Restore for archive
      const actionsHtml = currentView === 'active'
        ? `
          <button class="action-btn edit-btn" title="Edit" aria-label="Edit record" data-uuid="${r.uuid}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="action-btn delete-btn" title="Archive / Delete" aria-label="Archive record" data-uuid="${r.uuid}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        `
        : `
          <button class="action-btn restore-btn" title="Restore to Active List" aria-label="Restore record" data-uuid="${r.uuid}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
        `;

      return `
        <tr data-uuid="${r.uuid}">
          <td class="sno-cell">${sno}</td>
          <td>${compNum}</td>
          <td>${fileNum}</td>
          <td class="subject-cell">${subject}</td>
          <td>${dateVal}</td>
          <td>${userVal}</td>
          <td>
            <div class="action-btns">
              ${actionsHtml}
            </div>
          </td>
        </tr>`;
    }).join('');

    // Attach action handlers
    tableBody.querySelectorAll('.edit-btn').forEach(btn =>
      btn.addEventListener('click', () => startEdit(btn.dataset.uuid))
    );
    tableBody.querySelectorAll('.delete-btn').forEach(btn =>
      btn.addEventListener('click', () => confirmDelete(btn.dataset.uuid))
    );
    tableBody.querySelectorAll('.restore-btn').forEach(btn =>
      btn.addEventListener('click', () => confirmRestore(btn.dataset.uuid))
    );
  }

  function renderTableLoading() {
    tableBody.innerHTML = `
      <tr class="table-status-row">
        <td colspan="7">
          <div class="inline-spinner"></div>
          Loading records…
        </td>
      </tr>`;
    paginationEl.innerHTML = '';
  }

  function renderTableEmpty(message) {
    tableBody.innerHTML = `
      <tr class="table-status-row">
        <td colspan="7">${escapeHtml(message)}</td>
      </tr>`;
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }

    let html = '';

    // Prev
    html += `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Previous page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>`;

    // Page numbers (window of 5)
    const windowSize = 5;
    let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let end   = Math.min(totalPages, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);

    if (start > 1) {
      html += `<button class="page-btn" data-page="1">1</button>`;
      if (start > 2) html += `<span style="color:var(--clr-text-dim);padding:0 4px;">…</span>`;
    }

    for (let p = start; p <= end; p++) {
      html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (end < totalPages) {
      if (end < totalPages - 1) html += `<span style="color:var(--clr-text-dim);padding:0 4px;">…</span>`;
      html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next
    html += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} aria-label="Next page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>`;

    paginationEl.innerHTML = html;

    paginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page, 10);
        if (p >= 1 && p <= totalPages && p !== currentPage) {
          currentPage = p;
          renderTable();
          renderPagination();
          document.querySelector('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function updateRecordCount(total) {
    const shown = filteredRecords.length;
    const viewName = currentView === 'active' ? 'active' : 'archived';
    if (searchInput.value.trim()) {
      recordCountEl.textContent = `${shown} of ${total} ${viewName} records`;
    } else {
      recordCountEl.textContent = `${total} ${viewName} record${total !== 1 ? 's' : ''}`;
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  EDIT
   * ═════════════════════════════════════════════════════════════════════ */
  function startEdit(uuid) {
    const record = allActiveRecords.find(r => r.uuid === uuid);
    if (!record) return;

    isEditMode = true;
    editUuidInput.value = uuid;
    compNumInput.value  = record.e_office_computer_number || '';
    fileNumInput.value  = record.e_office_file_number || '';
    subjectInput.value  = record.e_office_file_subject || '';

    formTitle.textContent = 'Edit Record';
    submitBtnText.textContent = 'Update';

    // Scroll to form
    document.getElementById('form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    compNumInput.focus();
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DELETE / ARCHIVE & RESTORE (Modal Handlers)
   * ═════════════════════════════════════════════════════════════════════ */
  function confirmDelete(uuid) {
    const record = allActiveRecords.find(r => r.uuid === uuid);
    if (!record) return;

    modalAction = 'delete';
    modalTarget = uuid;

    modalTitleText.textContent = 'Confirm Deletion';
    modalIcon.innerHTML = `
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    `;
    modalIcon.style.color = 'var(--clr-danger)';
    modalMsg.textContent = `Are you sure you want to delete file "${record.e_office_computer_number}"? It will be moved to the Archive List.`;

    modalConfirmBtn.className = 'btn btn-danger';
    modalConfirmText.textContent = 'Delete';

    actionModal.classList.add('open');
  }

  function confirmRestore(uuid) {
    const record = allArchivedRecords.find(r => r.uuid === uuid);
    if (!record) return;

    modalAction = 'restore';
    modalTarget = uuid;

    modalTitleText.textContent = 'Confirm Restore';
    modalIcon.innerHTML = `
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    `;
    modalIcon.style.color = 'var(--clr-success)';
    modalMsg.textContent = `Are you sure you want to restore file "${record.e_office_computer_number}" back to the Active List?`;

    modalConfirmBtn.className = 'btn btn-success';
    modalConfirmText.textContent = 'Restore';

    actionModal.classList.add('open');
  }

  modalCancelBtn.addEventListener('click', closeActionModal);
  actionModal.addEventListener('click', (e) => {
    if (e.target === actionModal) closeActionModal();
  });

  function closeActionModal() {
    actionModal.classList.remove('open');
    modalTarget = null;
    modalConfirmBtn.classList.remove('loading');
    modalConfirmBtn.disabled = false;
  }

  modalConfirmBtn.addEventListener('click', async () => {
    if (!modalTarget) return;
    modalConfirmBtn.classList.add('loading');
    modalConfirmBtn.disabled = true;

    try {
      const client = getSupabaseClient();

      if (modalAction === 'delete') {
        const deletedBy = currentProfile?.email || currentUser?.email || currentUser?.id || 'Authenticated User';
        const deletedAt = new Date().toISOString();

        // Soft delete: update is_deleted, deleted_at, deleted_by
        const { error } = await client
          .from('e_office_files')
          .update({
            is_deleted: true,
            deleted_at: deletedAt,
            deleted_by: deletedBy
          })
          .eq('uuid', modalTarget);

        if (error) {
          showToast('Failed to delete record: ' + error.message, 'error');
        } else {
          showToast('Record moved to Archive List.', 'success');
          await loadRecords();
        }

      } else if (modalAction === 'restore') {
        // Restore: set is_deleted back to false, clear deleted_at & deleted_by
        const { error } = await client
          .from('e_office_files')
          .update({
            is_deleted: false,
            deleted_at: null,
            deleted_by: null
          })
          .eq('uuid', modalTarget);

        if (error) {
          showToast('Failed to restore record: ' + error.message, 'error');
        } else {
          showToast('Record restored to Active List.', 'success');
          await loadRecords();
        }
      }

    } catch (err) {
      showToast('Network error: ' + (err.message || 'Unknown error'), 'error');
    }

    closeActionModal();
  });


  /* ═════════════════════════════════════════════════════════════════════
   *  HELPERS
   * ═════════════════════════════════════════════════════════════════════ */

  function resetForm() {
    form.reset();
    editUuidInput.value = '';
    isEditMode = false;
    formTitle.textContent = 'Add New Record';
    submitBtnText.textContent = 'Create';

    // Clear validation
    [compNumInput, fileNumInput].forEach(el => el.classList.remove('invalid'));
    [compNumErr, fileNumErr].forEach(el => el.classList.remove('visible'));
  }

  function setFormLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('loading', on);
    cancelBtn.disabled = on;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function getInitials(name) {
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (_) { return iso; }
  }

  /**
   * Turn common Supabase/Postgres errors into user-friendly messages.
   */
  function friendlyDbError(error, action) {
    const msg = (error.message || '').toLowerCase();
    const detail = (error.details || '').toLowerCase();
    const code = error.code || '';

    // Unique constraint violations
    if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
      if (msg.includes('computer_number') || detail.includes('computer_number')) {
        return 'This E-Office Computer Number already exists. Please use a different one.';
      }
      if (msg.includes('file_number') || detail.includes('file_number')) {
        return 'This E-Office File Number already exists. Please use a different one.';
      }
      return 'A record with these details already exists.';
    }

    // RLS / permission
    if (code === '42501' || msg.includes('permission') || msg.includes('policy')) {
      return `You do not have permission to ${action} this record.`;
    }

    return `Failed to ${action} record: ${error.message}`;
  }

})();
