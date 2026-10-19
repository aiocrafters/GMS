/* =====================================================================
 *  e-office-files.js — E-Office Files page behaviour
 *  Handles CRUD operations, Active / Archive lists, search, pagination
 *  powered by DataTables with Supabase server-side processing.
 * ===================================================================== */

(function () {
  'use strict';

  /* ── Column Database Field Mapping ── */
  const COLUMN_DB_MAP = {
    0: 'created_at',               // S.No.
    1: 'e_office_computer_number', // Computer Number
    2: 'e_office_file_number',     // File Number
    3: 'e_office_file_subject',    // Subject
    4: 'created_at',               // Date (created_at or deleted_at)
    5: 'created_by',               // User (created_by or deleted_by)
    6: 'created_at'                // Actions
  };

  /* ── State ── */
  let currentUser = null;
  let currentProfile = null;
  let currentView = 'active';        // 'active' | 'archive'
  let dataTableInstance = null;
  let currentRecords = [];           // current page records
  let isEditMode = false;
  let modalTarget = null;            // uuid of target record
  let modalAction = 'delete';        // 'delete' | 'restore'

  // Per-tab state for search and pagination preservation
  const listState = {
    active: { search: '', page: 0, length: 20 },
    archive: { search: '', page: 0, length: 20 }
  };

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

  // Table controls
  const refreshBtn      = document.getElementById('refresh-btn');

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
      setupFormListeners();
      setupTabListeners();
      setupTableActionListeners();
      setupModalListeners();

      pageShell.style.display = 'flex';
      hideLoading();

      // Initialize DataTables with server-side processing
      initDataTable();
      await updateBadgeCounts();

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

  function switchView(newView) {
    if (currentView === newView) return;

    // 1. Preserve current tab's state
    if (dataTableInstance) {
      listState[currentView].search = dataTableInstance.search();
      listState[currentView].page = dataTableInstance.page();
      listState[currentView].length = dataTableInstance.page.len();
    }

    // 2. Switch tab
    currentView = newView;

    if (newView === 'active') {
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

      if (tableTitleText) tableTitleText.textContent = 'Archive Records';
      if (colHeaderDate) colHeaderDate.textContent = 'Archived At';
      if (colHeaderUser) colHeaderUser.textContent = 'Archived By';
    }

    // 3. Restore new tab's search query and page state
    if (dataTableInstance) {
      const saved = listState[newView];
      dataTableInstance.search(saved.search || '');
      if (saved.length) dataTableInstance.page.len(saved.length);

      dataTableInstance.ajax.reload(() => {
        if (saved.page) {
          dataTableInstance.page(saved.page).draw('page');
        }
      }, false);
    }
  }

  async function updateBadgeCounts() {
    try {
      const client = getSupabaseClient();
      const [activeRes, archiveRes] = await Promise.all([
        client.from('e_office_files').select('uuid', { count: 'exact', head: true }).eq('is_deleted', false),
        client.from('e_office_files').select('uuid', { count: 'exact', head: true }).eq('is_deleted', true)
      ]);

      const activeCount = activeRes.count || 0;
      const archiveCount = archiveRes.count || 0;

      if (activeBadge) activeBadge.textContent = activeCount.toLocaleString();
      if (archiveBadge) archiveBadge.textContent = archiveCount.toLocaleString();

    } catch (err) {
      console.error('Error fetching badge counts:', err);
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM VALIDATION & SUBMIT
   * ═════════════════════════════════════════════════════════════════════ */
  function setupFormListeners() {
    compNumInput.addEventListener('input', () => {
      compNumInput.classList.remove('invalid');
      compNumErr.classList.remove('visible');
    });

    fileNumInput.addEventListener('input', () => {
      fileNumInput.classList.remove('invalid');
      fileNumErr.classList.remove('visible');
    });

    cancelBtn.addEventListener('click', resetForm);
    form.addEventListener('submit', handleFormSubmit);
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

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

    if (currentView === 'archive' && !isEditMode) {
      switchView('active');
    } else if (dataTableInstance) {
      dataTableInstance.ajax.reload(null, false);
    }
    await updateBadgeCounts();
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DATATABLES INITIALIZATION (Built-in Search, Sort, Paging, Page-Length)
   * ═════════════════════════════════════════════════════════════════════ */
  function initDataTable() {
    if (dataTableInstance) {
      dataTableInstance.destroy();
      dataTableInstance = null;
    }

    dataTableInstance = new DataTable('#data-table', {
      serverSide: true,
      processing: true,
      pageLength: 20,
      lengthMenu: [10, 20, 25, 50, 100],
      order: [[4, 'desc']], // Default: Created At / Archived At descending
      scrollX: true,
      language: {
        search: '_INPUT_',
        searchPlaceholder: 'Search by number or subject…',
        lengthMenu: 'Show _MENU_ entries',
        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoEmpty: 'No records available',
        infoFiltered: '(filtered from _MAX_ total)',
        zeroRecords: `No ${currentView === 'active' ? 'active' : 'archived'} records found`,
        processing: '<div class="inline-spinner" style="margin:0 auto 8px;"></div>Loading data…',
        paginate: {
          first: '«',
          previous: '‹',
          next: '›',
          last: '»'
        }
      },
      columnDefs: [
        { targets: 0, orderable: false, searchable: false, width: '55px' },
        { targets: 3, className: 'subject-cell' },
        { targets: 6, orderable: false, searchable: false, width: '90px' }
      ],
      ajax: async function (data, callback, settings) {
        try {
          const client = getSupabaseClient();
          const isArchive = (currentView === 'archive');

          let query = client
            .from('e_office_files')
            .select('*', { count: 'exact' })
            .eq('is_deleted', isArchive);

          // Built-in search
          const q = (data.search && data.search.value) ? data.search.value.trim() : '';
          if (q) {
            query = query.or(`e_office_computer_number.ilike.%${q}%,e_office_file_number.ilike.%${q}%,e_office_file_subject.ilike.%${q}%`);
          }

          // Built-in sorting
          if (data.order && data.order.length > 0) {
            const ord = data.order[0];
            const colIdx = ord.column !== undefined ? ord.column : ord.col;
            let dbCol = COLUMN_DB_MAP[colIdx] || 'created_at';
            if (colIdx === 4) dbCol = isArchive ? 'deleted_at' : 'created_at';
            if (colIdx === 5) dbCol = isArchive ? 'deleted_by' : 'created_by';
            const ascending = (ord.dir === 'asc');
            query = query.order(dbCol, { ascending });
            if (dbCol !== 'created_at') {
              query = query.order('created_at', { ascending: false });
            }
          } else {
            const defaultCol = isArchive ? 'deleted_at' : 'created_at';
            query = query.order(defaultCol, { ascending: false });
          }

          // Pagination range
          const start = data.start || 0;
          const length = data.length || 20;
          query = query.range(start, start + length - 1);

          const { data: records, count, error } = await query;

          if (error) {
            console.error('Supabase query error:', error);
            showToast('Error loading records: ' + error.message, 'error');
            callback({
              draw: data.draw,
              recordsTotal: 0,
              recordsFiltered: 0,
              data: []
            });
            return;
          }

          currentRecords = records || [];

          // Transform records into 7 columns
          const rows = currentRecords.map((r, i) => {
            const sno = start + i + 1;
            const compNum = escapeHtml(r.e_office_computer_number || '—');
            const fileNum = `<span style="font-weight:500;">${escapeHtml(r.e_office_file_number || '—')}</span>`;
            const subject = escapeHtml(r.e_office_file_subject || '—');

            const dateVal = isArchive
              ? (r.deleted_at ? formatDate(r.deleted_at) : '—')
              : (r.created_at ? formatDate(r.created_at) : '—');

            const userVal = isArchive
              ? escapeHtml(r.deleted_by || '—')
              : escapeHtml(r.created_by || '—');

            const actionsHtml = !isArchive
              ? `<div class="action-btns">
                  <button class="action-btn edit-btn" title="Edit" aria-label="Edit record" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button class="action-btn delete-btn" title="Archive / Delete" aria-label="Delete record" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                </div>`
              : `<div class="action-btns">
                  <button class="action-btn restore-btn" title="Restore to Active List" aria-label="Restore record" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                    </svg>
                  </button>
                </div>`;

            return [
              sno, compNum, fileNum, subject, dateVal, userVal, actionsHtml
            ];
          });

          callback({
            draw: data.draw,
            recordsTotal: count || 0,
            recordsFiltered: count || 0,
            data: rows
          });

          // Refresh badge counts in background
          updateBadgeCounts();

        } catch (err) {
          console.error('DataTables ajax error:', err);
          showToast('Network error loading records.', 'error');
          callback({
            draw: data.draw,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: []
          });
        }
      }
    });
  }

  function setupTableActionListeners() {
    // Delegated click listener on #data-table for edit, delete, and restore
    const tableEl = document.getElementById('data-table');
    tableEl.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-btn');
      if (editBtn) {
        startEdit(editBtn.dataset.uuid);
        return;
      }
      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        confirmDelete(deleteBtn.dataset.uuid);
        return;
      }
      const restoreBtn = e.target.closest('.restore-btn');
      if (restoreBtn) {
        confirmRestore(restoreBtn.dataset.uuid);
        return;
      }
    });

    // Refresh button
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      if (dataTableInstance) {
        dataTableInstance.ajax.reload(() => {
          refreshBtn.classList.remove('spinning');
        }, false);
      } else {
        refreshBtn.classList.remove('spinning');
      }
      await updateBadgeCounts();
    });
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  EDIT RECORD
   * ═════════════════════════════════════════════════════════════════════ */
  async function startEdit(uuid) {
    let record = currentRecords.find(r => r.uuid === uuid);
    if (!record) {
      const client = getSupabaseClient();
      const { data, error } = await client.from('e_office_files').select('*').eq('uuid', uuid).single();
      if (error || !data) {
        showToast('Unable to find record for editing.', 'error');
        return;
      }
      record = data;
    }

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
  async function confirmDelete(uuid) {
    let record = currentRecords.find(r => r.uuid === uuid);
    if (!record) {
      const client = getSupabaseClient();
      const { data } = await client.from('e_office_files').select('*').eq('uuid', uuid).single();
      record = data;
    }
    const compNum = record?.e_office_computer_number || 'selected file';

    modalAction = 'delete';
    modalTarget = uuid;

    modalTitleText.textContent = 'Confirm Deletion';
    modalIcon.innerHTML = `
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    `;
    modalIcon.style.color = 'var(--clr-danger)';
    modalMsg.textContent = `Are you sure you want to delete file "${compNum}"? It will be moved to the Archive List.`;

    modalConfirmBtn.className = 'btn btn-danger';
    modalConfirmText.textContent = 'Delete';

    actionModal.classList.add('open');
  }

  async function confirmRestore(uuid) {
    let record = currentRecords.find(r => r.uuid === uuid);
    if (!record) {
      const client = getSupabaseClient();
      const { data } = await client.from('e_office_files').select('*').eq('uuid', uuid).single();
      record = data;
    }
    const compNum = record?.e_office_computer_number || 'selected file';

    modalAction = 'restore';
    modalTarget = uuid;

    modalTitleText.textContent = 'Confirm Restore';
    modalIcon.innerHTML = `
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    `;
    modalIcon.style.color = 'var(--clr-success)';
    modalMsg.textContent = `Are you sure you want to restore file "${compNum}" back to the Active List?`;

    modalConfirmBtn.className = 'btn btn-success';
    modalConfirmText.textContent = 'Restore';

    actionModal.classList.add('open');
  }

  function setupModalListeners() {
    modalCancelBtn.addEventListener('click', closeActionModal);
    actionModal.addEventListener('click', (e) => {
      if (e.target === actionModal) closeActionModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && actionModal.classList.contains('open')) {
        closeActionModal();
      }
    });

    modalConfirmBtn.addEventListener('click', handleModalConfirm);
  }

  function closeActionModal() {
    actionModal.classList.remove('open');
    modalTarget = null;
    modalConfirmBtn.classList.remove('loading');
    modalConfirmBtn.disabled = false;
  }

  async function handleModalConfirm() {
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
          if (dataTableInstance) dataTableInstance.ajax.reload(null, false);
          await updateBadgeCounts();
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
          if (dataTableInstance) dataTableInstance.ajax.reload(null, false);
          await updateBadgeCounts();
        }
      }

    } catch (err) {
      showToast('Network error: ' + (err.message || 'Unknown error'), 'error');
    }

    closeActionModal();
  }


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
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
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
