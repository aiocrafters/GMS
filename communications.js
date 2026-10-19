/* =====================================================================
 *  communications.js — Communications Management Behaviour
 *  Main table view integrated with DataTables library,
 *  "+ New Communication Record" popup modal,
 *  Active List / Archive List tabs, soft deletion, and restoration.
 * ===================================================================== */

(function () {
  'use strict';

  /* ── Constants ── */
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  /* ── State ── */
  let currentUser = null;
  let currentProfile = null;
  let eofficeFilesMap = new Map();   // uuid -> file record
  let currentView = 'active';        // 'active' | 'archive'
  let isEditMode = false;
  let isSubmitting = false;          // prevents closing modal during submit
  let confirmTargetUuid = null;
  let confirmAction = 'delete';      // 'delete' | 'restore'

  // DataTables instance & records cache
  let dataTableInstance = null;
  let currentRecords = [];

  // Separate states for Active List and Archive List
  const listState = {
    active: { page: 0, search: '', length: 20 },
    archive: { page: 0, search: '', length: 20 }
  };

  // Map DataTables column index (0-18) to Supabase table column names
  const COLUMN_DB_MAP = [
    'created_at',                             // 0: S. No.
    'e_office_file_number',                   // 1: E-Office File Number
    'e_office_computer_number',               // 2: E-Office Computer Number
    'communication_number',                   // 3: Communication Number
    'communication_date',                     // 4: Communication Date
    'communication_year',                     // 5: Communication Year
    'communication_month',                    // 6: Communication Month
    'communication_eoffice_receipt_number',   // 7: E-Office Receipt Number
    'communication_type',                     // 8: Communication Type
    'communication_received_from',            // 9: Received From
    'communication_sender_name',              // 10: Sender Name
    'communication_sender_designation',       // 11: Sender Designation
    'communication_subject',                  // 12: Communication Subject
    'total_representations',                  // 13: Total Representations
    'grievances_portal',                      // 14: Grievances Portal
    'departmental_channels',                  // 15: Departmental Channels
    'non_actionable',                         // 16: Non Actionable
    'total_representations',                  // 17: Pending (fallback sort)
    'created_at'                              // 18: Actions (fallback sort)
  ];

  /* ── DOM refs ── */
  const pageShell            = document.getElementById('page-shell');
  const logoutBtn            = document.getElementById('logout-btn');

  // Modal: Form popup
  const btnOpenModal         = document.getElementById('btn-open-modal');
  const formModal            = document.getElementById('form-modal');
  const modalCloseX          = document.getElementById('modal-close-x');
  const formModalTitleText   = document.getElementById('form-modal-title-text');
  const form                 = document.getElementById('comm-form');
  const editUuidInput        = document.getElementById('edit-uuid');
  const eofficeUuidInput     = document.getElementById('e-office-uuid');
  const selectEofficeFile    = document.getElementById('select-eoffice-file');
  const eofficeFileNumInput  = document.getElementById('eoffice-file-number');
  const eofficeCompNumInput  = document.getElementById('eoffice-computer-number');
  const commNumInput         = document.getElementById('communication-number');
  const commDateInput        = document.getElementById('communication-date');
  const commYearInput        = document.getElementById('communication-year');
  const commMonthInput       = document.getElementById('communication-month');
  const receiptNumInput      = document.getElementById('eoffice-receipt-number');
  const commTypeSelect       = document.getElementById('communication-type');
  const receivedFromSelect   = document.getElementById('communication-received-from');
  const senderNameInput      = document.getElementById('communication-sender-name');
  const senderDesigInput     = document.getElementById('communication-sender-designation');
  const subjectInput         = document.getElementById('communication-subject');
  const totalRepInput        = document.getElementById('total-representations');
  const submitBtn            = document.getElementById('submit-btn');
  const submitBtnText        = document.getElementById('submit-btn-text');
  const cancelBtn            = document.getElementById('cancel-btn');

  // Error labels
  const eofficeFileErr       = document.getElementById('eoffice-file-error');
  const commNumErr           = document.getElementById('comm-number-error');
  const commDateErr          = document.getElementById('comm-date-error');
  const receivedFromErr      = document.getElementById('received-from-error');
  const commSubjectErr       = document.getElementById('comm-subject-error');

  // Table Tabs & Header Controls
  const tabActive            = document.getElementById('tab-active');
  const tabArchive           = document.getElementById('tab-archive');
  const activeBadge          = document.getElementById('active-badge');
  const archiveBadge         = document.getElementById('archive-badge');
  const tableTitleText       = document.getElementById('table-title-text');
  const refreshBtn           = document.getElementById('refresh-btn');

  // Modal: Action confirmation (Soft delete / restore)
  const confirmModal         = document.getElementById('confirm-modal');
  const confirmModalIcon     = document.getElementById('confirm-modal-icon');
  const confirmTitleText     = document.getElementById('confirm-title-text');
  const confirmModalMsg      = document.getElementById('confirm-modal-message');
  const confirmCancelBtn     = document.getElementById('confirm-cancel-btn');
  const confirmActionBtn     = document.getElementById('confirm-action-btn');
  const confirmActionText    = document.getElementById('confirm-action-text');


  /* ═════════════════════════════════════════════════════════════════════
   *  INIT
   * ═════════════════════════════════════════════════════════════════════ */
  (async function init() {
    try {
      const { session, error } = await getSession();
      if (error || !session) {
        window.location.replace('index.html');
        return;
      }

      currentUser = session.user;

      try {
        const res = await fetchUserProfile(currentUser.id);
        if (!res.error && res.profile) currentProfile = res.profile;
      } catch (_) { /* use auth data */ }

      populateNav();
      setupFormListeners();
      setupModalListeners();
      setupTabListeners();
      setupTableActionListeners();

      pageShell.style.display = 'flex';
      hideLoading();

      // Load reference data in parallel
      await Promise.all([
        loadEofficeFilesDropdown(),
        loadDepartmentsDropdown()
      ]);

      // Initialize DataTables & badge counts
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
   *  POPUP MODAL HANDLERS
   * ═════════════════════════════════════════════════════════════════════ */
  function setupModalListeners() {
    // Open modal button
    btnOpenModal.addEventListener('click', () => {
      resetForm();
      openFormModal('New Communication Record', 'Create');
    });

    // Close button (X)
    modalCloseX.addEventListener('click', () => {
      if (!isSubmitting) closeFormModal();
    });

    // Cancel button inside modal
    cancelBtn.addEventListener('click', () => {
      if (!isSubmitting) closeFormModal();
    });

    // Backdrop click outside modal
    formModal.addEventListener('click', (e) => {
      if (e.target === formModal && !isSubmitting) {
        closeFormModal();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && formModal.classList.contains('open') && !isSubmitting) {
        closeFormModal();
      }
    });
  }

  function openFormModal(title, submitLabel) {
    formModalTitleText.textContent = title;
    submitBtnText.textContent = submitLabel;
    formModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => selectEofficeFile.focus(), 100);
  }

  function closeFormModal() {
    formModal.classList.remove('open');
    document.body.style.overflow = '';
    resetForm();
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DROPDOWN POPULATION — E-Office Files & Departments
   * ═════════════════════════════════════════════════════════════════════ */
  async function loadEofficeFilesDropdown() {
    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('e_office_files')
        .select('uuid, e_office_file_number, e_office_computer_number, e_office_file_subject')
        .eq('is_deleted', false)
        .order('e_office_file_number', { ascending: true })
        .limit(3500);

      if (error) {
        console.error('Failed to load E-Office files:', error);
        selectEofficeFile.innerHTML = '<option value="">-- Error loading files --</option>';
        return;
      }

      eofficeFilesMap.clear();
      let optionsHtml = '<option value="">-- Choose an E-Office File --</option>';

      (data || []).forEach(f => {
        eofficeFilesMap.set(f.uuid, f);
        const fileNum = f.e_office_file_number || 'No File #';
        const compNum = f.e_office_computer_number || 'No Comp #';
        const subject = f.e_office_file_subject ? ` — ${f.e_office_file_subject.slice(0, 50)}` : '';
        optionsHtml += `<option value="${f.uuid}">${escapeHtml(fileNum)} (${escapeHtml(compNum)})${escapeHtml(subject)}</option>`;
      });

      selectEofficeFile.innerHTML = optionsHtml;

    } catch (err) {
      console.error('Error in loadEofficeFilesDropdown:', err);
    }
  }

  async function loadDepartmentsDropdown() {
    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('Departments')
        .select('"Department Name"')
        .order('Department Name', { ascending: true });

      if (error) {
        console.error('Failed to load departments:', error);
        receivedFromSelect.innerHTML = '<option value="">-- Error loading departments --</option>';
        return;
      }

      let optionsHtml = '<option value="">-- Select Receiving Department --</option>';
      (data || []).forEach(d => {
        const deptName = d['Department Name'];
        if (deptName) {
          optionsHtml += `<option value="${escapeHtml(deptName)}">${escapeHtml(deptName)}</option>`;
        }
      });

      receivedFromSelect.innerHTML = optionsHtml;

    } catch (err) {
      console.error('Error in loadDepartmentsDropdown:', err);
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM LISTENERS & AUTO-DERIVED FIELDS
   * ═════════════════════════════════════════════════════════════════════ */
  function setupFormListeners() {
    // 1. When E-Office file is selected, auto-populate File Number & Computer Number
    selectEofficeFile.addEventListener('change', () => {
      const uuid = selectEofficeFile.value;
      selectEofficeFile.classList.remove('invalid');
      eofficeFileErr.classList.remove('visible');

      if (uuid && eofficeFilesMap.has(uuid)) {
        const file = eofficeFilesMap.get(uuid);
        eofficeFileNumInput.value = file.e_office_file_number || '';
        eofficeCompNumInput.value = file.e_office_computer_number || '';
        eofficeUuidInput.value = file.uuid;
      } else {
        eofficeFileNumInput.value = '';
        eofficeCompNumInput.value = '';
        eofficeUuidInput.value = '';
      }
    });

    // 2. When Communication Date changes, derive Year and Month
    commDateInput.addEventListener('change', updateDerivedDateFields);
    commDateInput.addEventListener('input', updateDerivedDateFields);

    function updateDerivedDateFields() {
      const val = commDateInput.value;
      commDateInput.classList.remove('invalid');
      commDateErr.classList.remove('visible');

      if (val) {
        const parts = val.split('-');
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10);
          const monthIdx = parseInt(parts[1], 10) - 1;

          if (!isNaN(year) && year >= 1970 && year <= 2099) {
            commYearInput.value = year;
            commMonthInput.value = (monthIdx >= 0 && monthIdx < 12) ? MONTH_NAMES[monthIdx] : '';
            return;
          }
        }
      }
      commYearInput.value = '';
      commMonthInput.value = '';
    }

    // Real-time validation clearance
    commNumInput.addEventListener('input', () => {
      commNumInput.classList.remove('invalid');
      commNumErr.classList.remove('visible');
    });
    receivedFromSelect.addEventListener('change', () => {
      receivedFromSelect.classList.remove('invalid');
      receivedFromErr.classList.remove('visible');
    });
    subjectInput.addEventListener('input', () => {
      subjectInput.classList.remove('invalid');
      commSubjectErr.classList.remove('visible');
    });

    // Form Submit
    form.addEventListener('submit', handleFormSubmit);
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM SUBMIT — Create or Update Record
   * ═════════════════════════════════════════════════════════════════════ */
  async function handleFormSubmit(e) {
    e.preventDefault();

    let valid = true;

    // Validate 1: Select E-Office File
    const eofficeUuid = selectEofficeFile.value;
    if (!eofficeUuid) {
      selectEofficeFile.classList.add('invalid');
      eofficeFileErr.classList.add('visible');
      valid = false;
    }

    // Validate 4: Communication Number
    const commNumber = commNumInput.value.trim();
    if (!commNumber) {
      commNumInput.classList.add('invalid');
      commNumErr.classList.add('visible');
      valid = false;
    }

    // Validate 5: Communication Date
    const commDate = commDateInput.value;
    if (!commDate) {
      commDateInput.classList.add('invalid');
      commDateErr.classList.add('visible');
      valid = false;
    }

    // Validate 10: Received From
    const receivedFrom = receivedFromSelect.value;
    if (!receivedFrom) {
      receivedFromSelect.classList.add('invalid');
      receivedFromErr.classList.add('visible');
      valid = false;
    }

    // Validate 13: Communication Subject
    const subject = subjectInput.value.trim();
    if (!subject) {
      subjectInput.classList.add('invalid');
      commSubjectErr.classList.add('visible');
      valid = false;
    }

    if (!valid) return;

    setFormLoading(true);
    isSubmitting = true;

    const client = getSupabaseClient();
    const editUuid = editUuidInput.value;

    const commYear = parseInt(commYearInput.value, 10) || new Date(commDate).getFullYear();
    const commMonth = commMonthInput.value || MONTH_NAMES[new Date(commDate).getMonth()];

    const payload = {
      e_office_uuid: eofficeUuid || null,
      e_office_file_number: eofficeFileNumInput.value.trim() || null,
      e_office_computer_number: eofficeCompNumInput.value.trim() || null,
      communication_number: commNumber,
      communication_date: commDate,
      communication_year: commYear,
      communication_month: commMonth,
      communication_eoffice_receipt_number: receiptNumInput.value.trim() || null,
      communication_type: commTypeSelect.value,
      communication_received_from: receivedFrom,
      communication_sender_name: senderNameInput.value.trim() || null,
      communication_sender_designation: senderDesigInput.value.trim() || null,
      communication_subject: subject,
      total_representations: parseInt(totalRepInput.value, 10) || 0,
      updated_at: new Date().toISOString()
    };

    try {
      if (isEditMode && editUuid) {
        /* ── UPDATE ── */
        const { error } = await client
          .from('communications')
          .update(payload)
          .eq('uuid', editUuid);

        if (error) {
          showToast('Failed to update record: ' + error.message, 'error');
          setFormLoading(false);
          isSubmitting = false;
          return;
        }

        showToast('Communication record updated successfully.', 'success');

      } else {
        /* ── INSERT (Active by default) ── */
        payload.is_deleted = false;
        payload.deleted_at = null;
        payload.deleted_by = null;
        payload.created_by = currentProfile?.email || currentUser.email || 'System';
        payload.created_at = new Date().toISOString();

        const { error } = await client
          .from('communications')
          .insert(payload);

        if (error) {
          showToast('Failed to create record: ' + error.message, 'error');
          setFormLoading(false);
          isSubmitting = false;
          return;
        }

        showToast('Communication record created successfully.', 'success');
      }

      setFormLoading(false);
      isSubmitting = false;
      closeFormModal();

      // If in archive view and user created a record, switch to active view to show it
      if (currentView === 'archive' && !isEditMode) {
        switchView('active');
      } else if (dataTableInstance) {
        dataTableInstance.ajax.reload(null, false);
      }
      await updateBadgeCounts();

    } catch (err) {
      console.error('Error submitting form:', err);
      showToast('Network error saving communication.', 'error');
      setFormLoading(false);
      isSubmitting = false;
    }
  }

  function resetForm() {
    form.reset();
    editUuidInput.value = '';
    eofficeUuidInput.value = '';
    isEditMode = false;

    formModalTitleText.textContent = 'New Communication Record';
    submitBtnText.textContent = 'Create';

    // Clear read-only auto fields
    eofficeFileNumInput.value = '';
    eofficeCompNumInput.value = '';
    commYearInput.value = '';
    commMonthInput.value = '';

    // Clear validation styling
    [selectEofficeFile, commNumInput, commDateInput, receivedFromSelect, subjectInput].forEach(el => {
      if (el) el.classList.remove('invalid');
    });
    [eofficeFileErr, commNumErr, commDateErr, receivedFromErr, commSubjectErr].forEach(el => {
      if (el) el.classList.remove('visible');
    });
  }

  function setFormLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('loading', on);
    cancelBtn.disabled = on;
    modalCloseX.disabled = on;
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  ACTIVE LIST & ARCHIVE LIST TABS
   * ═════════════════════════════════════════════════════════════════════ */
  function setupTabListeners() {
    tabActive.addEventListener('click', () => switchView('active'));
    tabArchive.addEventListener('click', () => switchView('archive'));
  }

  function switchView(newView) {
    if (currentView === newView) return;

    // 1. Preserve current tab's search query, page, and length
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
      tableTitleText.textContent = 'Active Communications';
    } else {
      tabArchive.classList.add('active');
      tabArchive.setAttribute('aria-selected', 'true');
      tabActive.classList.remove('active');
      tabActive.setAttribute('aria-selected', 'false');
      tableTitleText.textContent = 'Archived Communications';
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
        client.from('communications').select('uuid', { count: 'exact', head: true }).eq('is_deleted', false),
        client.from('communications').select('uuid', { count: 'exact', head: true }).eq('is_deleted', true)
      ]);

      const activeCount = activeRes.count || 0;
      const archiveCount = archiveRes.count || 0;

      activeBadge.textContent = activeCount.toLocaleString();
      archiveBadge.textContent = archiveCount.toLocaleString();

    } catch (err) {
      console.error('Error fetching badge counts:', err);
    }
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
      order: [[4, 'desc']], // Default: Communication Date descending
      scrollX: true,
      language: {
        search: '_INPUT_',
        searchPlaceholder: 'Search by number, subject, file, sender…',
        lengthMenu: 'Show _MENU_ entries',
        info: 'Showing _START_ to _END_ of _TOTAL_ communications',
        infoEmpty: 'No communication records available',
        infoFiltered: '(filtered from _MAX_ total)',
        zeroRecords: `No ${currentView === 'active' ? 'active' : 'archived'} communications found`,
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
        { targets: 17, orderable: false }, // Pending
        { targets: 18, orderable: false, searchable: false, width: '90px' } // Actions
      ],
      ajax: async function (data, callback, settings) {
        try {
          const client = getSupabaseClient();
          const isArchive = (currentView === 'archive');

          let query = client
            .from('communications')
            .select('*', { count: 'exact' })
            .eq('is_deleted', isArchive);

          // Built-in search
          const q = (data.search && data.search.value) ? data.search.value.trim() : '';
          if (q) {
            query = query.or(`communication_number.ilike.%${q}%,e_office_file_number.ilike.%${q}%,e_office_computer_number.ilike.%${q}%,communication_subject.ilike.%${q}%,communication_received_from.ilike.%${q}%,communication_sender_name.ilike.%${q}%`);
          }

          // Built-in sorting
          if (data.order && data.order.length > 0) {
            const ord = data.order[0];
            const colIdx = ord.column !== undefined ? ord.column : ord.col;
            const dbCol = COLUMN_DB_MAP[colIdx] || 'created_at';
            const ascending = (ord.dir === 'asc');
            query = query.order(dbCol, { ascending });
            if (dbCol !== 'created_at') {
              query = query.order('created_at', { ascending: false });
            }
          } else {
            query = query.order('created_at', { ascending: false });
          }

          // Pagination range
          const start = data.start || 0;
          const length = data.length || 20;
          query = query.range(start, start + length - 1);

          const { data: records, count, error } = await query;

          if (error) {
            console.error('Supabase query error:', error);
            showToast('Error loading communications: ' + error.message, 'error');
            callback({
              draw: data.draw,
              recordsTotal: 0,
              recordsFiltered: 0,
              data: []
            });
            return;
          }

          currentRecords = records || [];

          // Transform records into 19 column cells
          const rows = currentRecords.map((r, i) => {
            const sno = start + i + 1;
            const fileNum = `<span style="font-weight:500;">${escapeHtml(r.e_office_file_number || '—')}</span>`;
            const compNum = escapeHtml(r.e_office_computer_number || '—');
            const commNum = `<span style="color:var(--clr-primary);font-weight:600;">${escapeHtml(r.communication_number || '—')}</span>`;
            const commDate = r.communication_date ? formatDateOnly(r.communication_date) : '—';
            const commYear = r.communication_year || '—';
            const commMonth = escapeHtml(r.communication_month || '—');
            const receiptNum = escapeHtml(r.communication_eoffice_receipt_number || '—');
            const commType = `<span class="badge badge-type">${escapeHtml(r.communication_type || 'Letter')}</span>`;
            const receivedFrom = `<span style="display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.communication_received_from || '')}">${escapeHtml(r.communication_received_from || '—')}</span>`;
            const senderName = escapeHtml(r.communication_sender_name || '—');
            const senderDesig = escapeHtml(r.communication_sender_designation || '—');
            const subject = `<span class="subject-col" title="${escapeHtml(r.communication_subject || '')}">${escapeHtml(r.communication_subject || '—')}</span>`;

            const totalRep = Number(r.total_representations) || 0;
            const grievPortal = Number(r.grievances_portal) || 0;
            const deptChannels = Number(r.departmental_channels) || 0;
            const nonActionable = Number(r.non_actionable) || 0;
            const pending = totalRep - (grievPortal + deptChannels + nonActionable);

            const totalRepBadge = `<span class="badge badge-primary">${totalRep}</span>`;
            const grievPortalBadge = `<span class="badge badge-accent">${grievPortal}</span>`;
            const deptChannelsBadge = `<span class="badge badge-purple">${deptChannels}</span>`;
            const nonActionableBadge = `<span class="badge badge-muted">${nonActionable}</span>`;
            const pendingBadge = `<span class="badge badge-pending">${pending}</span>`;

            const actionsHtml = (currentView === 'active')
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
              sno, fileNum, compNum, commNum, commDate, commYear, commMonth,
              receiptNum, commType, receivedFrom, senderName, senderDesig,
              subject, totalRepBadge, grievPortalBadge, deptChannelsBadge,
              nonActionableBadge, pendingBadge, actionsHtml
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
          showToast('Network error loading communications.', 'error');
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
        openConfirmModal('delete', deleteBtn.dataset.uuid);
        return;
      }
      const restoreBtn = e.target.closest('.restore-btn');
      if (restoreBtn) {
        openConfirmModal('restore', restoreBtn.dataset.uuid);
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
   *  EDIT RECORD (Opens Form Modal)
   * ═════════════════════════════════════════════════════════════════════ */
  async function startEdit(uuid) {
    let record = currentRecords.find(r => r.uuid === uuid);
    if (!record) {
      const client = getSupabaseClient();
      const { data, error } = await client.from('communications').select('*').eq('uuid', uuid).single();
      if (error || !data) {
        showToast('Unable to find record for editing.', 'error');
        return;
      }
      record = data;
    }

    isEditMode = true;
    editUuidInput.value = uuid;
    eofficeUuidInput.value = record.e_office_uuid || '';

    if (record.e_office_uuid) {
      selectEofficeFile.value = record.e_office_uuid;
    }

    eofficeFileNumInput.value = record.e_office_file_number || '';
    eofficeCompNumInput.value = record.e_office_computer_number || '';
    commNumInput.value = record.communication_number || '';
    commDateInput.value = record.communication_date || '';
    commYearInput.value = record.communication_year || '';
    commMonthInput.value = record.communication_month || '';
    receiptNumInput.value = record.communication_eoffice_receipt_number || '';
    commTypeSelect.value = record.communication_type || 'Letter';
    receivedFromSelect.value = record.communication_received_from || '';
    senderNameInput.value = record.communication_sender_name || '';
    senderDesigInput.value = record.communication_sender_designation || '';
    subjectInput.value = record.communication_subject || '';
    totalRepInput.value = record.total_representations || 0;

    openFormModal('Edit Communication Record', 'Update');
    setTimeout(() => commNumInput.focus(), 120);
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  SOFT DELETE & RESTORE (Confirmation Modal Handlers)
   * ═════════════════════════════════════════════════════════════════════ */
  async function openConfirmModal(action, uuid) {
    let record = currentRecords.find(r => r.uuid === uuid);
    if (!record) {
      const client = getSupabaseClient();
      const { data, error } = await client.from('communications').select('*').eq('uuid', uuid).single();
      if (error || !data) {
        showToast('Record not found.', 'error');
        return;
      }
      record = data;
    }

    confirmAction = action;
    confirmTargetUuid = uuid;

    if (action === 'delete') {
      confirmTitleText.textContent = 'Confirm Deletion';
      confirmModalIcon.innerHTML = `
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      `;
      confirmModalIcon.style.color = 'var(--clr-danger)';
      confirmModalMsg.textContent = `Are you sure you want to delete communication "${record.communication_number}"? The record will be moved to the Archive List.`;
      confirmActionBtn.className = 'btn btn-danger';
      confirmActionText.textContent = 'Delete';

    } else if (action === 'restore') {
      confirmTitleText.textContent = 'Confirm Restore';
      confirmModalIcon.innerHTML = `
        <polyline points="1 4 1 10 7 10"/>
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
      `;
      confirmModalIcon.style.color = 'var(--clr-success)';
      confirmModalMsg.textContent = `Are you sure you want to restore communication "${record.communication_number}" back to the Active List?`;
      confirmActionBtn.className = 'btn btn-success';
      confirmActionText.textContent = 'Restore';
    }

    confirmModal.classList.add('open');
  }

  confirmCancelBtn.addEventListener('click', closeConfirmModal);
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirmModal();
  });

  function closeConfirmModal() {
    confirmModal.classList.remove('open');
    confirmTargetUuid = null;
    confirmActionBtn.classList.remove('loading');
    confirmActionBtn.disabled = false;
  }

  confirmActionBtn.addEventListener('click', async () => {
    if (!confirmTargetUuid) return;
    confirmActionBtn.classList.add('loading');
    confirmActionBtn.disabled = true;

    try {
      const client = getSupabaseClient();

      if (confirmAction === 'delete') {
        const deletedBy = currentProfile?.email || currentUser?.email || currentUser?.id || 'Authenticated User';
        const deletedAt = new Date().toISOString();

        // Soft delete: update is_deleted, deleted_at, deleted_by (NO .delete())
        const { error } = await client
          .from('communications')
          .update({
            is_deleted: true,
            deleted_at: deletedAt,
            deleted_by: deletedBy
          })
          .eq('uuid', confirmTargetUuid);

        if (error) {
          showToast('Failed to delete communication: ' + error.message, 'error');
        } else {
          showToast('Communication moved to Archive List.', 'success');
          if (dataTableInstance) {
            dataTableInstance.ajax.reload(null, false);
          }
          await updateBadgeCounts();
        }

      } else if (confirmAction === 'restore') {
        // Restore: reset is_deleted back to false, clear deleted_at & deleted_by
        const { error } = await client
          .from('communications')
          .update({
            is_deleted: false,
            deleted_at: null,
            deleted_by: null
          })
          .eq('uuid', confirmTargetUuid);

        if (error) {
          showToast('Failed to restore communication: ' + error.message, 'error');
        } else {
          showToast('Communication restored to Active List.', 'success');
          if (dataTableInstance) {
            dataTableInstance.ajax.reload(null, false);
          }
          await updateBadgeCounts();
        }
      }

    } catch (err) {
      showToast('Network error: ' + (err.message || 'Unknown error'), 'error');
    }

    closeConfirmModal();
  });


  /* ═════════════════════════════════════════════════════════════════════
   *  HELPERS
   * ═════════════════════════════════════════════════════════════════════ */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function getInitials(name) {
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDateOnly(isoDate) {
    try {
      const [year, month, day] = isoDate.split('-');
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch (_) {
      return isoDate;
    }
  }

})();
