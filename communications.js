/* =====================================================================
 *  communications.js — Communications Management Behaviour
 *  Main table view, "+ New Communication Record" popup modal,
 *  Active List / Archive List tabs, soft deletion, and restoration.
 * ===================================================================== */

(function () {
  'use strict';

  /* ── Constants ── */
  const PAGE_SIZE = 20;
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
  let searchTimer = null;

  // Separate states for Active List and Archive List
  const listState = {
    active: { page: 1, search: '', totalCount: 0, records: [] },
    archive: { page: 1, search: '', totalCount: 0, records: [] }
  };

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

  // Table, Tabs & Toolbar
  const tabActive            = document.getElementById('tab-active');
  const tabArchive           = document.getElementById('tab-archive');
  const activeBadge          = document.getElementById('active-badge');
  const archiveBadge         = document.getElementById('archive-badge');
  const tableTitleText       = document.getElementById('table-title-text');
  const searchInput          = document.getElementById('search-input');
  const refreshBtn           = document.getElementById('refresh-btn');
  const tableBody            = document.getElementById('table-body');
  const recordCountEl        = document.getElementById('record-count');
  const paginationEl         = document.getElementById('pagination');

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

      pageShell.style.display = 'flex';
      hideLoading();

      // Load reference data in parallel
      await Promise.all([
        loadEofficeFilesDropdown(),
        loadDepartmentsDropdown()
      ]);

      // Load initial communications table & badges
      await Promise.all([
        loadCommunications(),
        updateBadgeCounts()
      ]);

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
      } else {
        await loadCommunications();
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

    // 1. Preserve current tab's search query
    listState[currentView].search = searchInput.value;

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
    searchInput.value = listState[newView].search || '';
    loadCommunications();
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

      listState.active.totalCount = activeCount;
      listState.archive.totalCount = archiveCount;

    } catch (err) {
      console.error('Error fetching badge counts:', err);
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DATA TABLE — Server-Side Paginated Query (18 Columns)
   * ═════════════════════════════════════════════════════════════════════ */
  async function loadCommunications() {
    renderTableLoading();
    refreshBtn.classList.add('spinning');

    const state = listState[currentView];
    const isDeletedFilter = (currentView === 'archive');

    try {
      const client = getSupabaseClient();
      const start = (state.page - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      let query = client
        .from('communications')
        .select('*', { count: 'exact' })
        .eq('is_deleted', isDeletedFilter);

      const q = searchInput.value.trim();
      if (q) {
        query = query.or(`communication_number.ilike.%${q}%,e_office_file_number.ilike.%${q}%,e_office_computer_number.ilike.%${q}%,communication_subject.ilike.%${q}%,communication_received_from.ilike.%${q}%,communication_sender_name.ilike.%${q}%`);
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(start, end);

      if (error) {
        showToast('Error loading communications: ' + error.message, 'error');
        renderTableEmpty('Error loading records.');
        refreshBtn.classList.remove('spinning');
        return;
      }

      state.records = data || [];
      state.totalCount = count || 0;

      // Clamp page if out of bounds
      const maxPage = Math.max(1, Math.ceil(state.totalCount / PAGE_SIZE));
      if (state.page > maxPage) {
        state.page = maxPage;
        await loadCommunications();
        return;
      }

      renderTable();
      renderPagination();
      updateRecordCount();

    } catch (err) {
      console.error('Error loading communications:', err);
      showToast('Network error loading communications.', 'error');
      renderTableEmpty('Network error loading records.');
    }

    refreshBtn.classList.remove('spinning');
  }

  // Refresh
  refreshBtn.addEventListener('click', async () => {
    await Promise.all([
      loadCommunications(),
      updateBadgeCounts()
    ]);
  });

  // Search (debounced)
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      listState[currentView].page = 1;
      loadCommunications();
    }, 300);
  });

  function renderTable() {
    const state = listState[currentView];
    const start = (state.page - 1) * PAGE_SIZE;

    if (state.records.length === 0) {
      const msg = searchInput.value.trim()
        ? `No ${currentView === 'active' ? 'active' : 'archived'} communications match "${searchInput.value}".`
        : `No ${currentView === 'active' ? 'active' : 'archived'} communication records available.`;
      renderTableEmpty(msg);
      return;
    }

    tableBody.innerHTML = state.records.map((r, i) => {
      const sno = start + i + 1;
      const fileNum = escapeHtml(r.e_office_file_number || '—');
      const compNum = escapeHtml(r.e_office_computer_number || '—');
      const commNum = escapeHtml(r.communication_number || '—');
      const commDate = r.communication_date ? formatDateOnly(r.communication_date) : '—';
      const commYear = r.communication_year || '—';
      const commMonth = escapeHtml(r.communication_month || '—');
      const receiptNum = escapeHtml(r.communication_eoffice_receipt_number || '—');
      const commType = escapeHtml(r.communication_type || 'Letter');
      const receivedFrom = escapeHtml(r.communication_received_from || '—');
      const senderName = escapeHtml(r.communication_sender_name || '—');
      const senderDesig = escapeHtml(r.communication_sender_designation || '—');
      const subject = escapeHtml(r.communication_subject || '—');

      const totalRep = Number(r.total_representations) || 0;
      const grievPortal = Number(r.grievances_portal) || 0;
      const deptChannels = Number(r.departmental_channels) || 0;
      const nonActionable = Number(r.non_actionable) || 0;
      const pending = totalRep - (grievPortal + deptChannels + nonActionable);

      // Action buttons: Edit & Delete for Active, Restore for Archive (NO permanent delete)
      const actionsHtml = currentView === 'active'
        ? `
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
        `
        : `
          <button class="action-btn restore-btn" title="Restore to Active List" aria-label="Restore record" data-uuid="${r.uuid}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
        `;

      return `
        <tr data-uuid="${r.uuid}">
          <td style="font-weight:600;color:var(--clr-text-dim);">${sno}</td>
          <td><span style="font-weight:500;">${fileNum}</span></td>
          <td>${compNum}</td>
          <td><span style="color:var(--clr-primary);font-weight:600;">${commNum}</span></td>
          <td>${commDate}</td>
          <td>${commYear}</td>
          <td>${commMonth}</td>
          <td>${receiptNum}</td>
          <td><span class="badge badge-type">${commType}</span></td>
          <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;" title="${receivedFrom}">${receivedFrom}</td>
          <td>${senderName}</td>
          <td>${senderDesig}</td>
          <td class="subject-col" title="${subject}">${subject}</td>
          <td><span class="badge badge-primary">${totalRep}</span></td>
          <td><span class="badge badge-accent">${grievPortal}</span></td>
          <td><span class="badge badge-purple">${deptChannels}</span></td>
          <td><span class="badge badge-muted">${nonActionable}</span></td>
          <td><span class="badge badge-pending">${pending}</span></td>
          <td>
            <div class="action-btns">
              ${actionsHtml}
            </div>
          </td>
        </tr>`;
    }).join('');

    // Attach row action listeners
    tableBody.querySelectorAll('.edit-btn').forEach(btn =>
      btn.addEventListener('click', () => startEdit(btn.dataset.uuid))
    );
    tableBody.querySelectorAll('.delete-btn').forEach(btn =>
      btn.addEventListener('click', () => openConfirmModal('delete', btn.dataset.uuid))
    );
    tableBody.querySelectorAll('.restore-btn').forEach(btn =>
      btn.addEventListener('click', () => openConfirmModal('restore', btn.dataset.uuid))
    );
  }

  function renderTableLoading() {
    tableBody.innerHTML = `
      <tr class="table-status-row">
        <td colspan="19">
          <div class="inline-spinner"></div>
          Loading ${currentView === 'active' ? 'active' : 'archived'} communications…
        </td>
      </tr>`;
    paginationEl.innerHTML = '';
  }

  function renderTableEmpty(message) {
    tableBody.innerHTML = `
      <tr class="table-status-row">
        <td colspan="19">${escapeHtml(message)}</td>
      </tr>`;
  }

  function renderPagination() {
    const state = listState[currentView];
    const totalPages = Math.max(1, Math.ceil(state.totalCount / PAGE_SIZE));
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }

    let html = '';

    // Prev
    html += `<button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>`;

    // Page numbers (window of 5)
    const windowSize = 5;
    let start = Math.max(1, state.page - Math.floor(windowSize / 2));
    let end   = Math.min(totalPages, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);

    if (start > 1) {
      html += `<button class="page-btn" data-page="1">1</button>`;
      if (start > 2) html += `<span style="color:var(--clr-text-dim);padding:0 4px;">…</span>`;
    }

    for (let p = start; p <= end; p++) {
      html += `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (end < totalPages) {
      if (end < totalPages - 1) html += `<span style="color:var(--clr-text-dim);padding:0 4px;">…</span>`;
      html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next
    html += `<button class="page-btn" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''} aria-label="Next page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>`;

    paginationEl.innerHTML = html;

    paginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page, 10);
        if (p >= 1 && p <= totalPages && p !== state.page) {
          state.page = p;
          loadCommunications();
          document.querySelector('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function updateRecordCount() {
    const state = listState[currentView];
    const start = (state.page - 1) * PAGE_SIZE + 1;
    const end = Math.min(state.totalCount, start + state.records.length - 1);
    const viewName = currentView === 'active' ? 'active' : 'archived';

    if (state.totalCount === 0) {
      recordCountEl.textContent = `0 ${viewName} records`;
    } else {
      recordCountEl.textContent = `Showing ${start}–${end} of ${state.totalCount.toLocaleString()} ${viewName} communications`;
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  EDIT RECORD (Opens Form Modal)
   * ═════════════════════════════════════════════════════════════════════ */
  function startEdit(uuid) {
    const state = listState[currentView];
    const record = state.records.find(r => r.uuid === uuid);
    if (!record) return;

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
  function openConfirmModal(action, uuid) {
    const state = listState[currentView];
    const record = state.records.find(r => r.uuid === uuid);
    if (!record) return;

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
          await Promise.all([
            loadCommunications(),
            updateBadgeCounts()
          ]);
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
          await Promise.all([
            loadCommunications(),
            updateBadgeCounts()
          ]);
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
