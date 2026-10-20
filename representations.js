/* =====================================================================
 *  representations.js — Representations Register page behavior
 *  Handles CRUD operations, Active / Archive lists, search, sorting,
 *  pagination powered by DataTables with Supabase server-side processing.
 * ===================================================================== */

(function () {
  'use strict';

  /* ── Constants ── */
  const DB_TABLE = 'registered_representations';

  // Map DataTables column index (0-10) to Supabase table column names
  const COLUMN_DB_MAP = [
    'created_at',                     // 0: S. No.
    'e_office_computer_number',       // 1: E-Office Computer Number
    'e_office_file_number',           // 2: E-Office File Number
    'communication_number',           // 3: Communication Number
    'communication_date',             // 4: Communication Date
    'representation_serial_number',   // 5: Representation Serial Number
    'applicant_name',                 // 6: Applicant Name
    'representation_subject',         // 7: Representation Subject
    'processing_channel',             // 8: Processing Channel
    'created_at',                     // 9: Created At / Archived At
    'created_at'                      // 10: Actions
  ];

  /* ── State ── */
  let currentUser = null;
  let currentProfile = null;
  let currentView = 'active';        // 'active' | 'archive'
  let dataTableInstance = null;
  let currentRecords = [];           // current page records
  let isEditMode = false;
  let isSubmitting = false;

  // Cached reference lists
  let eOfficeFilesList = [];
  let currentFileCommsList = [];

  // Confirmation modal state
  let confirmAction = null;          // 'delete' | 'restore'
  let confirmTargetUuid = null;

  // Per-tab state for search and pagination preservation
  const listState = {
    active: { page: 0, search: '', length: 20 },
    archive: { page: 0, search: '', length: 20 }
  };

  /* ── DOM refs ── */
  const pageShell            = document.getElementById('page-shell');
  const logoutBtn            = document.getElementById('logout-btn');

  // Modal: Form popup
  const btnOpenModal         = document.getElementById('btn-open-modal');
  const formModal            = document.getElementById('form-modal');
  const modalCloseX          = document.getElementById('modal-close-x');
  const formCancelBtn        = document.getElementById('form-cancel-btn');
  const formSubmitBtn        = document.getElementById('form-submit-btn');
  const formSubmitBtnText    = document.getElementById('form-submit-btn-text');
  const formModalTitleText   = document.getElementById('form-modal-title-text');
  const repForm              = document.getElementById('rep-form');

  // Form Fields
  const editUuidInput        = document.getElementById('edit-uuid');
  const eOfficeUuidInput     = document.getElementById('e-office-uuid');
  const eOfficeCompNumInput  = document.getElementById('e-office-computer-number');
  const eOfficeFileNumInput  = document.getElementById('e-office-file-number');
  const commUuidInput        = document.getElementById('received-communications-uuid');
  const commNumInput         = document.getElementById('communication-number');
  const commDateInput        = document.getElementById('communication-date');

  const selectEofficeFile    = document.getElementById('select-eoffice-file');
  const selectCommNumber     = document.getElementById('select-communication-number');
  const serialNumberInput    = document.getElementById('representation-serial-number');
  const applicantNameInput   = document.getElementById('applicant-name');
  const subjectInput         = document.getElementById('representation-subject');
  const processingChannelSel = document.getElementById('processing-channel');

  // Error elements
  const eofficeFileError     = document.getElementById('eoffice-file-error');
  const commError            = document.getElementById('comm-error');
  const serialError          = document.getElementById('serial-error');
  const serialErrorText      = document.getElementById('serial-error-text');
  const applicantError       = document.getElementById('applicant-error');
  const subjectError         = document.getElementById('subject-error');
  const channelError         = document.getElementById('channel-error');

  // E-Office Info Pill
  const eofficeInfoPill      = document.getElementById('eoffice-info-pill');
  const pillCompNo           = document.getElementById('pill-comp-no');
  const pillFileNo           = document.getElementById('pill-file-no');

  // Tabs & Counts
  const tabActive            = document.getElementById('tab-active');
  const tabArchive           = document.getElementById('tab-archive');
  const activeBadge          = document.getElementById('active-badge');
  const archiveBadge         = document.getElementById('archive-badge');
  const tableTitleText       = document.getElementById('table-title-text');
  const colHeaderDate        = document.getElementById('col-header-date');
  const refreshBtn           = document.getElementById('refresh-btn');

  // Confirmation modal
  const confirmModal         = document.getElementById('confirm-modal');
  const confirmModalTitle    = document.getElementById('confirm-modal-title');
  const confirmTitleText     = document.getElementById('confirm-title-text');
  const confirmModalMessage  = document.getElementById('confirm-modal-message');
  const confirmCancelBtn     = document.getElementById('confirm-cancel-btn');
  const confirmActionBtn     = document.getElementById('confirm-action-btn');
  const confirmActionText    = document.getElementById('confirm-action-text');


  /* ═════════════════════════════════════════════════════════════════════
   *  INIT & AUTH
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

      // Pre-load E-Office Files dropdown reference data
      await loadEofficeFilesDropdown();

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
    const name = currentProfile?.name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
    const role = currentProfile?.role || 'User';

    setText('nav-user-name', name);
    setText('nav-user-role', role);
    setText('nav-avatar', getInitials(name));

    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      showLoading();
      await signOut();
      window.location.replace('index.html');
    });
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DROPDOWN DATA LOADERS
   * ═════════════════════════════════════════════════════════════════════ */
  async function loadEofficeFilesDropdown() {
    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('e_office_files')
        .select('uuid, e_office_computer_number, e_office_file_number')
        .eq('is_deleted', false)
        .order('e_office_computer_number', { ascending: true });

      if (error) {
        console.error('Error fetching e_office_files:', error);
        return;
      }

      eOfficeFilesList = data || [];
      populateEofficeSelect();

    } catch (err) {
      console.error('Network error loading E-Office files:', err);
    }
  }

  function populateEofficeSelect(selectedUuid = '') {
    selectEofficeFile.innerHTML = '<option value="">-- Choose an E-Office File --</option>';

    eOfficeFilesList.forEach(file => {
      const opt = document.createElement('option');
      opt.value = file.uuid;
      const compNum = file.e_office_computer_number || 'No Comp #';
      const fileNum = file.e_office_file_number || 'No File #';
      opt.textContent = `${compNum} — ${fileNum}`;
      if (file.uuid === selectedUuid) opt.selected = true;
      selectEofficeFile.appendChild(opt);
    });
  }

  async function loadCommunicationsForFile(eOfficeUuid, preselectedCommUuid = '') {
    if (!eOfficeUuid) {
      selectCommNumber.innerHTML = '<option value="">-- Select an E-Office File first --</option>';
      selectCommNumber.disabled = true;
      currentFileCommsList = [];
      return;
    }

    selectCommNumber.disabled = true;
    selectCommNumber.innerHTML = '<option value="">-- Loading communications... --</option>';

    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('received_communications')
        .select('uuid, communication_number, communication_date')
        .eq('e_office_files_uuid', eOfficeUuid)
        .eq('is_deleted', false)
        .order('communication_date', { ascending: false });

      if (error) {
        console.error('Error loading communications:', error);
        selectCommNumber.innerHTML = '<option value="">-- Failed to load communications --</option>';
        return;
      }

      currentFileCommsList = data || [];

      if (currentFileCommsList.length === 0) {
        selectCommNumber.innerHTML = '<option value="">-- No communications found for this file --</option>';
        selectCommNumber.disabled = false;
        return;
      }

      selectCommNumber.innerHTML = '<option value="">-- Choose Communication --</option>';
      currentFileCommsList.forEach(comm => {
        const opt = document.createElement('option');
        opt.value = comm.uuid;
        const commNum = comm.communication_number || 'Untitled Comm';
        const commDate = comm.communication_date ? ` (${formatDateOnly(comm.communication_date)})` : '';
        opt.textContent = `${commNum}${commDate}`;
        if (comm.uuid === preselectedCommUuid) opt.selected = true;
        selectCommNumber.appendChild(opt);
      });

      selectCommNumber.disabled = false;

    } catch (err) {
      console.error('Network error loading communications:', err);
      selectCommNumber.innerHTML = '<option value="">-- Network error loading communications --</option>';
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM LISTENERS & REACTIVE DEPENDENCIES
   * ═════════════════════════════════════════════════════════════════════ */
  function setupFormListeners() {
    // 1. When E-Office file changes
    selectEofficeFile.addEventListener('change', async () => {
      clearFieldError(selectEofficeFile, eofficeFileError);
      clearFieldError(selectCommNumber, commError);

      const selectedUuid = selectEofficeFile.value;
      if (!selectedUuid) {
        eOfficeUuidInput.value = '';
        eOfficeCompNumInput.value = '';
        eOfficeFileNumInput.value = '';
        commUuidInput.value = '';
        commNumInput.value = '';
        commDateInput.value = '';

        eofficeInfoPill.style.display = 'none';
        selectCommNumber.innerHTML = '<option value="">-- Select an E-Office File first --</option>';
        selectCommNumber.disabled = true;
        return;
      }

      const file = eOfficeFilesList.find(f => f.uuid === selectedUuid);
      if (file) {
        eOfficeUuidInput.value = file.uuid;
        eOfficeCompNumInput.value = file.e_office_computer_number || '';
        eOfficeFileNumInput.value = file.e_office_file_number || '';

        pillCompNo.textContent = file.e_office_computer_number || '—';
        pillFileNo.textContent = file.e_office_file_number || '—';
        eofficeInfoPill.style.display = 'flex';
      }

      // Clear existing selected communication whenever E-Office file changes
      commUuidInput.value = '';
      commNumInput.value = '';
      commDateInput.value = '';

      // Populate communications for this file
      await loadCommunicationsForFile(selectedUuid);
    });

    // 2. When Communication Number changes
    selectCommNumber.addEventListener('change', () => {
      clearFieldError(selectCommNumber, commError);
      const selectedCommUuid = selectCommNumber.value;
      if (!selectedCommUuid) {
        commUuidInput.value = '';
        commNumInput.value = '';
        commDateInput.value = '';
        return;
      }

      const comm = currentFileCommsList.find(c => c.uuid === selectedCommUuid);
      if (comm) {
        commUuidInput.value = comm.uuid;
        commNumInput.value = comm.communication_number || '';
        commDateInput.value = comm.communication_date || '';
      }
    });

    // 3. Serial Number input validations
    serialNumberInput.addEventListener('keydown', (e) => {
      if (['-', '+', 'e', 'E', '.'].includes(e.key)) {
        e.preventDefault();
      }
    });

    serialNumberInput.addEventListener('input', () => {
      clearFieldError(serialNumberInput, serialError);
      if (serialNumberInput.value !== '') {
        const val = parseInt(serialNumberInput.value, 10);
        if (isNaN(val) || val <= 0) {
          serialNumberInput.value = '';
        } else {
          serialNumberInput.value = val;
        }
      }
    });

    // Clear validation errors on inputs
    applicantNameInput.addEventListener('input', () => clearFieldError(applicantNameInput, applicantError));
    subjectInput.addEventListener('input', () => clearFieldError(subjectInput, subjectError));
    processingChannelSel.addEventListener('change', () => clearFieldError(processingChannelSel, channelError));

    // Submit & Cancel
    formSubmitBtn.addEventListener('click', handleFormSubmit);
    formCancelBtn.addEventListener('click', closeFormModal);
  }

  function clearFieldError(inputEl, errorEl) {
    if (inputEl) inputEl.classList.remove('invalid');
    if (errorEl) errorEl.classList.remove('visible');
  }

  function showFieldError(inputEl, errorEl, msg = '') {
    if (inputEl) inputEl.classList.add('invalid');
    if (errorEl) {
      if (msg) {
        const span = errorEl.querySelector('span');
        if (span) span.textContent = msg;
      }
      errorEl.classList.add('visible');
    }
  }




  function openCreateModal() {
    isEditMode = false;
    resetForm();
    formModalTitleText.textContent = 'Add New Representation';
    formSubmitBtnText.textContent = 'Save Representation';
    formModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => selectEofficeFile.focus(), 120);
  }

  async function openEditModal(uuid) {
    if (!uuid) return;
    showLoading();

    let record = currentRecords.find(r => r.uuid === uuid);
    if (!record) {
      try {
        const client = getSupabaseClient();
        const { data, error } = await client.from(DB_TABLE).select('*').eq('uuid', uuid).single();
        if (error || !data) {
          hideLoading();
          showToast('Unable to load representation record.', 'error');
          return;
        }
        record = data;
      } catch (err) {
        hideLoading();
        showToast('Network error loading representation.', 'error');
        return;
      }
    }
    hideLoading();

    isEditMode = true;
    resetForm();
    formModalTitleText.textContent = 'Edit Representation';
    formSubmitBtnText.textContent = 'Update Representation';

    // Populate hidden inputs
    editUuidInput.value = record.uuid;
    eOfficeUuidInput.value = record.e_office_uuid;
    eOfficeCompNumInput.value = record.e_office_computer_number || '';
    eOfficeFileNumInput.value = record.e_office_file_number || '';
    commUuidInput.value = record.received_communications_uuid;
    commNumInput.value = record.communication_number || '';
    commDateInput.value = record.communication_date || '';

    // 1. Select E-Office File
    populateEofficeSelect(record.e_office_uuid);
    pillCompNo.textContent = record.e_office_computer_number || '—';
    pillFileNo.textContent = record.e_office_file_number || '—';
    eofficeInfoPill.style.display = 'flex';

    // 2. Load and Select Communication Number
    await loadCommunicationsForFile(record.e_office_uuid, record.received_communications_uuid);

    // 3. Serial Number
    serialNumberInput.value = record.representation_serial_number != null ? record.representation_serial_number : '';

    // 4. Applicant Name
    applicantNameInput.value = record.applicant_name || '';

    // 5. Subject
    subjectInput.value = record.representation_subject || '';

    // 6. Processing Channel
    processingChannelSel.value = record.processing_channel || '';

    formModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => serialNumberInput.focus(), 120);
  }

  function closeFormModal() {
    formModal.classList.remove('open');
    document.body.style.overflow = '';
    resetForm();
  }

  function resetForm() {
    repForm.reset();
    editUuidInput.value = '';
    eOfficeUuidInput.value = '';
    eOfficeCompNumInput.value = '';
    eOfficeFileNumInput.value = '';
    commUuidInput.value = '';
    commNumInput.value = '';
    commDateInput.value = '';

    eofficeInfoPill.style.display = 'none';
    selectCommNumber.innerHTML = '<option value="">-- Select an E-Office File first --</option>';
    selectCommNumber.disabled = true;

    [
      selectEofficeFile, selectCommNumber, serialNumberInput,
      applicantNameInput, subjectInput, processingChannelSel
    ].forEach(inp => {
      if (inp) inp.classList.remove('invalid');
    });

    [
      eofficeFileError, commError, serialError,
      applicantError, subjectError, channelError
    ].forEach(err => {
      if (err) err.classList.remove('visible');
    });

    setFormLoading(false);
    isSubmitting = false;
  }

  function setFormLoading(on) {
    isSubmitting = on;
    formSubmitBtn.disabled = on;
    formSubmitBtn.classList.toggle('loading', on);
    formCancelBtn.disabled = on;
    modalCloseX.disabled = on;
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM SUBMISSION & VALIDATION
   * ═════════════════════════════════════════════════════════════════════ */
  async function handleFormSubmit(e) {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    let valid = true;

    // 1. Select E-Office File
    const eOfficeUuid = selectEofficeFile.value;
    if (!eOfficeUuid) {
      showFieldError(selectEofficeFile, eofficeFileError);
      valid = false;
    } else {
      clearFieldError(selectEofficeFile, eofficeFileError);
    }

    // 2. Select Communication Number
    const commUuid = selectCommNumber.value;
    if (!commUuid) {
      showFieldError(selectCommNumber, commError);
      valid = false;
    } else {
      clearFieldError(selectCommNumber, commError);
    }

    // 3. Representation Serial Number
    const serialVal = serialNumberInput.value.trim();
    const serialNum = parseInt(serialVal, 10);
    if (!serialVal || isNaN(serialNum) || serialNum <= 0) {
      showFieldError(serialNumberInput, serialError, 'Please enter a valid positive integer serial number (e.g. 1, 2, 3)');
      valid = false;
    } else {
      clearFieldError(serialNumberInput, serialError);
    }

    // 4. Applicant Name
    const applicantName = applicantNameInput.value.trim();
    if (!applicantName) {
      showFieldError(applicantNameInput, applicantError);
      valid = false;
    } else {
      clearFieldError(applicantNameInput, applicantError);
    }

    // 5. Representation Subject
    const subject = subjectInput.value.trim();
    if (!subject) {
      showFieldError(subjectInput, subjectError);
      valid = false;
    } else {
      clearFieldError(subjectInput, subjectError);
    }

    // 6. Processing Channel
    const channel = processingChannelSel.value;
    const allowedChannels = ['Grievances Portal', 'E-Office Portal', 'Letter', 'OM', 'Returned to Applicant', 'Non Actionable'];
    if (!channel || !allowedChannels.includes(channel)) {
      showFieldError(processingChannelSel, channelError);
      valid = false;
    } else {
      clearFieldError(processingChannelSel, channelError);
    }

    if (!valid) {
      showToast('Please correct the highlighted fields.', 'warning');
      return;
    }

    // Pre-flight check: Prevent duplicate representation serial numbers within the same communication
    try {
      const client = getSupabaseClient();
      let dupQuery = client
        .from(DB_TABLE)
        .select('uuid')
        .eq('received_communications_uuid', commUuid)
        .eq('representation_serial_number', serialNum)
        .eq('is_deleted', false);

      if (isEditMode && editUuidInput.value) {
        dupQuery = dupQuery.neq('uuid', editUuidInput.value);
      }

      const { data: existingDup, error: dupErr } = await dupQuery.limit(1);
      if (!dupErr && existingDup && existingDup.length > 0) {
        showFieldError(serialNumberInput, serialError, `Serial Number ${serialNum} is already assigned to another representation in this communication.`);
        showToast(`Serial Number ${serialNum} already exists in this communication.`, 'error');
        return;
      }
    } catch (_) { /* rely on DB unique index if network check skips */ }

    // Prepare payload
    setFormLoading(true);

    const payload = {
      e_office_uuid: eOfficeUuid,
      e_office_computer_number: eOfficeCompNumInput.value.trim(),
      e_office_file_number: eOfficeFileNumInput.value.trim(),
      received_communications_uuid: commUuid,
      communication_number: commNumInput.value.trim(),
      communication_date: commDateInput.value || null,
      representation_serial_number: serialNum,
      applicant_name: applicantName,
      representation_subject: subject,
      processing_channel: channel,
      updated_at: new Date().toISOString()
    };

    try {
      const client = getSupabaseClient();

      if (isEditMode) {
        const editUuid = editUuidInput.value;
        const { error } = await client
          .from(DB_TABLE)
          .update(payload)
          .eq('uuid', editUuid);

        if (error) {
          handleDbError(error, 'update');
          setFormLoading(false);
          return;
        }

        showToast('Representation updated successfully.', 'success');

      } else {
        // New record
        payload.created_by = currentUser?.id || currentProfile?.id || null;
        payload.created_at = new Date().toISOString();
        payload.is_deleted = false;

        const { error } = await client
          .from(DB_TABLE)
          .insert(payload);

        if (error) {
          handleDbError(error, 'create');
          setFormLoading(false);
          return;
        }

        showToast('Representation created successfully.', 'success');
      }

      setFormLoading(false);
      closeFormModal();

      if (currentView === 'archive' && !isEditMode) {
        switchView('active');
      } else if (dataTableInstance) {
        dataTableInstance.ajax.reload(null, false);
      }
      await updateBadgeCounts();

    } catch (err) {
      console.error('Error submitting representation:', err);
      showToast('Network error saving representation.', 'error');
      setFormLoading(false);
    }
  }

  function handleDbError(error, action) {
    console.error(`DB error on ${action}:`, error);
    if (error.code === '23505' || (error.message || '').includes('unique')) {
      showFieldError(serialNumberInput, serialError, 'Duplicate representation serial number for this communication.');
      showToast('A representation with this serial number already exists for this communication.', 'error');
    } else {
      showToast(`Failed to ${action} representation: ` + error.message, 'error');
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  TAB SWITCHING — Active List vs Archive List
   * ═════════════════════════════════════════════════════════════════════ */
  function setupTabListeners() {
    tabActive.addEventListener('click', () => switchView('active'));
    tabArchive.addEventListener('click', () => switchView('archive'));
  }

  function switchView(newView) {
    if (currentView === newView) return;

    // 1. Preserve current tab's state
    if (dataTableInstance) {
      listState[currentView].search = dataTableInstance.search();
      listState[currentView].page = dataTableInstance.page();
      listState[currentView].length = dataTableInstance.page.len();
    }

    currentView = newView;

    if (newView === 'active') {
      tabActive.classList.add('active');
      tabActive.setAttribute('aria-selected', 'true');
      tabArchive.classList.remove('active');
      tabArchive.setAttribute('aria-selected', 'false');
      tableTitleText.textContent = 'Active Representations';
      if (colHeaderDate) colHeaderDate.textContent = 'Created At';
    } else {
      tabArchive.classList.add('active');
      tabArchive.setAttribute('aria-selected', 'true');
      tabActive.classList.remove('active');
      tabActive.setAttribute('aria-selected', 'false');
      tableTitleText.textContent = 'Archived Representations';
      if (colHeaderDate) colHeaderDate.textContent = 'Archived At';
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
        client.from(DB_TABLE).select('uuid', { count: 'exact', head: true }).eq('is_deleted', false),
        client.from(DB_TABLE).select('uuid', { count: 'exact', head: true }).eq('is_deleted', true)
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
   *  DATATABLES INITIALIZATION
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
      order: [[9, 'desc']], // Default: Created At / Archived At descending
      scrollX: true,
      language: {
        search: '_INPUT_',
        searchPlaceholder: 'Search applicant, subject, number…',
        lengthMenu: 'Show _MENU_ entries',
        info: 'Showing _START_ to _END_ of _TOTAL_ representations',
        infoEmpty: 'No representation records available',
        infoFiltered: '(filtered from _MAX_ total)',
        zeroRecords: `No ${currentView === 'active' ? 'active' : 'archived'} representations found`,
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
        { targets: 5, type: 'num' }, // Representation Serial Number numeric sorting
        { targets: 10, orderable: false, searchable: false, width: '120px' } // Actions
      ],
      ajax: async function (data, callback, settings) {
        try {
          const client = getSupabaseClient();
          const isArchive = (currentView === 'archive');
          const q = (data.search && data.search.value) ? data.search.value.trim() : '';

          let query = client
            .from(DB_TABLE)
            .select('*', { count: 'exact' })
            .eq('is_deleted', isArchive);

          // Built-in search
          if (q) {
            query = query.or(`applicant_name.ilike.%${q}%,representation_subject.ilike.%${q}%,communication_number.ilike.%${q}%,e_office_file_number.ilike.%${q}%,e_office_computer_number.ilike.%${q}%,processing_channel.ilike.%${q}%`);
          }

          // Built-in sorting
          if (data.order && data.order.length > 0) {
            const ord = data.order[0];
            const colIdx = ord.column !== undefined ? ord.column : ord.col;
            let dbCol = COLUMN_DB_MAP[colIdx] || 'created_at';
            if (colIdx === 9) {
              dbCol = isArchive ? 'deleted_at' : 'created_at';
            }
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
            showToast('Error loading representations: ' + error.message, 'error');
            callback({
              draw: data.draw,
              recordsTotal: 0,
              recordsFiltered: 0,
              data: []
            });
            return;
          }

          currentRecords = records || [];

          // Transform records into 11 columns
          const rows = currentRecords.map((r, i) => {
            const sno = start + i + 1;
            const compNum = escapeHtml(r.e_office_computer_number || '—');
            const fileNum = `<span style="font-weight:500;">${escapeHtml(r.e_office_file_number || '—')}</span>`;
            const commNum = `<span style="color:var(--clr-primary);font-weight:600;">${escapeHtml(r.communication_number || '—')}</span>`;
            const commDate = r.communication_date ? formatDateOnly(r.communication_date) : '—';
            const serialNum = `<span class="badge badge-accent" style="font-weight:700;">#${r.representation_serial_number}</span>`;
            const applicant = `<span style="font-weight:600;">${escapeHtml(r.applicant_name || '—')}</span>`;
            const subject = `<span title="${escapeHtml(r.representation_subject || '')}">${escapeHtml(r.representation_subject || '—')}</span>`;

            // Channel badge
            const channelBadge = renderChannelBadge(r.processing_channel);

            // Date (created_at in active, deleted_at in archive)
            const dateVal = isArchive
              ? (r.deleted_at ? formatDate(r.deleted_at) : '—')
              : (r.created_at ? formatDate(r.created_at) : '—');

            // Actions
            const actionsHtml = (currentView === 'active')
              ? `<div class="action-btns">
                  <button class="action-btn edit-btn" title="Edit" aria-label="Edit representation" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    <span>Edit</span>
                  </button>
                  <button class="action-btn delete-btn" title="Archive / Delete" aria-label="Delete representation" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                    <span>Delete</span>
                  </button>
                </div>`
              : `<div class="action-btns">
                  <button class="action-btn restore-btn" title="Restore to Active List" aria-label="Restore representation" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                    </svg>
                    <span>Restore</span>
                  </button>
                </div>`;

            return [
              sno, compNum, fileNum, commNum, commDate,
              serialNum, applicant, subject, channelBadge,
              dateVal, actionsHtml
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
          showToast('Network error loading representations.', 'error');
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

  function renderChannelBadge(channel) {
    if (!channel) return '—';
    const ch = String(channel).trim();
    let badgeClass = 'badge-muted';
    if (ch === 'Grievances Portal') badgeClass = 'badge-accent';
    else if (ch === 'E-Office Portal') badgeClass = 'badge-primary';
    else if (ch === 'Letter') badgeClass = 'badge-info';
    else if (ch === 'OM') badgeClass = 'badge-purple';
    else if (ch === 'Returned to Applicant') badgeClass = 'badge-warning';
    else if (ch === 'Non Actionable') badgeClass = 'badge-muted';

    return `<span class="badge ${badgeClass}">${escapeHtml(ch)}</span>`;
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  TABLE ACTION LISTENERS (Edit, Delete, Restore, Refresh)
   * ═════════════════════════════════════════════════════════════════════ */
  function setupTableActionListeners() {
    const tableEl = document.getElementById('data-table');
    tableEl.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-btn');
      if (editBtn) {
        openEditModal(editBtn.dataset.uuid);
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
   *  CONFIRMATION MODAL (Soft Delete / Restore)
   * ═════════════════════════════════════════════════════════════════════ */
  function openConfirmModal(action, uuid) {
    confirmAction = action;
    confirmTargetUuid = uuid;

    const record = currentRecords.find(r => r.uuid === uuid);
    const identifier = record ? `#${record.representation_serial_number} (${record.applicant_name})` : 'this record';

    if (action === 'delete') {
      confirmTitleText.textContent = 'Archive Representation';
      confirmModalMessage.textContent = `Are you sure you want to move representation ${identifier} to the Archive List? (This record can be restored anytime).`;
      confirmActionText.textContent = 'Archive';
      confirmActionBtn.className = 'btn btn-danger';
    } else {
      confirmTitleText.textContent = 'Restore Representation';
      confirmModalMessage.textContent = `Are you sure you want to restore representation ${identifier} back to the Active List?`;
      confirmActionText.textContent = 'Restore';
      confirmActionBtn.className = 'btn btn-success';
    }

    confirmModal.classList.add('open');
  }

  function closeConfirmModal() {
    confirmModal.classList.remove('open');
    confirmAction = null;
    confirmTargetUuid = null;
    confirmActionBtn.classList.remove('loading');
    confirmActionBtn.disabled = false;
  }

  function setupModalListeners() {
    btnOpenModal.addEventListener('click', openCreateModal);
    modalCloseX.addEventListener('click', closeFormModal);

    formModal.addEventListener('click', (e) => {
      if (e.target === formModal && !isSubmitting) closeFormModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (confirmModal.classList.contains('open')) closeConfirmModal();
        else if (formModal.classList.contains('open') && !isSubmitting) closeFormModal();
      }
    });

    // Confirmation actions
    confirmCancelBtn.addEventListener('click', closeConfirmModal);
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) closeConfirmModal();
    });

    confirmActionBtn.addEventListener('click', async () => {
      if (!confirmTargetUuid || !confirmAction) return;

      confirmActionBtn.classList.add('loading');
      confirmActionBtn.disabled = true;

      try {
        const client = getSupabaseClient();
        const userUuid = currentUser?.id || currentProfile?.id || null;

        if (confirmAction === 'delete') {
          // Soft delete only
          const { error } = await client
            .from(DB_TABLE)
            .update({
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              deleted_by: userUuid
            })
            .eq('uuid', confirmTargetUuid);

          if (error) {
            showToast('Failed to archive representation: ' + error.message, 'error');
          } else {
            showToast('Representation moved to Archive List.', 'success');
            if (dataTableInstance) {
              dataTableInstance.ajax.reload(null, false);
            }
            await updateBadgeCounts();
          }

        } else if (confirmAction === 'restore') {
          // Restore
          const { error } = await client
            .from(DB_TABLE)
            .update({
              is_deleted: false,
              deleted_at: null,
              deleted_by: null,
              updated_at: new Date().toISOString()
            })
            .eq('uuid', confirmTargetUuid);

          if (error) {
            showToast('Failed to restore representation: ' + error.message, 'error');
          } else {
            showToast('Representation restored to Active List.', 'success');
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
  }


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
    div.textContent = String(str);
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

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (_) {
      return iso;
    }
  }

})();
