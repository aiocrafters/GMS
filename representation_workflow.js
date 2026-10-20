/* =====================================================================
 *  representation_workflow.js — Representation Workflow Management
 *  Handles CRUD, filters, active/archive views, DataTables integration,
 *  and cascading dependencies from E-Office Files -> Comms -> Reps.
 * ===================================================================== */

(function () {
  'use strict';

  /* ── Constants ── */
  const DB_TABLE = 'representation_workflow_records';

  // Map DataTables column index (0-10) to Supabase table column names
  const COLUMN_DB_MAP = [
    'created_at',                     // 0: S. No.
    'workflow_type',                  // 1: Workflow Type
    'e_office_computer_number',       // 2: E-Office File
    'communication_number',           // 3: Comm. Number
    'representation_serial_number',   // 4: Rep. Serial No.
    'applicant_name',                 // 5: Applicant Name
    'processing_channel',             // 6: Channel & ID
    'created_at',                     // 7: Workflow Action Details
    'representation_subject',         // 8: Subject
    'created_at',                     // 9: Created At / Deleted At
    'created_at'                      // 10: Actions
  ];

  /* ── State ── */
  let currentUser = null;
  let currentProfile = null;
  let currentView = 'active';        // 'active' | 'archive'
  let dataTableInstance = null;
  let currentRecords = [];
  let isEditMode = false;
  let isSubmitting = false;

  // Cached lists for cascading selection
  let eOfficeFilesList = [];
  let currentFileCommsList = [];
  let currentCommRepsList = [];

  // Filter state
  const filters = {
    workflowType: '',
    channel: '',
    commNumber: '',
    serialNumber: ''
  };

  // Confirmation modal state
  let confirmAction = null;          // 'delete' | 'restore'
  let confirmTargetUuid = null;

  // Tab state preservation
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
  const workflowForm         = document.getElementById('workflow-form');

  // Hidden Inputs
  const editUuidInput        = document.getElementById('edit-uuid');
  const eOfficeFilesUuidInp  = document.getElementById('e-office-files-uuid');
  const eOfficeCompNumInp    = document.getElementById('e-office-computer-number');
  const eOfficeFileNumInp    = document.getElementById('e-office-file-number');
  const commUuidInp          = document.getElementById('received-communications-uuid');
  const commNumInp           = document.getElementById('communication-number');
  const commDateInp          = document.getElementById('communication-date');
  const regRepUuidInp        = document.getElementById('registered-representations-uuid');
  const repSerialInp         = document.getElementById('representation-serial-number');
  const applicantNameInp     = document.getElementById('applicant-name');
  const subjectInp           = document.getElementById('representation-subject');
  const processingChannelInp = document.getElementById('processing-channel');

  // Form Fields
  const selectEofficeFile    = document.getElementById('select-eoffice-file');
  const selectCommNumber     = document.getElementById('select-communication-number');
  const selectRepresentation = document.getElementById('select-representation');
  const workflowTypeSelect   = document.getElementById('workflow-type');
  const channelIdNumberInput = document.getElementById('processing-channel-id-number');

  // Workflow Specific Sections
  const sectionForward       = document.getElementById('section-forward');
  const fwdDepartmentInput   = document.getElementById('forwarded-to-department');
  const fwdDateInput         = document.getElementById('forwarding-date');
  const fwdDispatchInput     = document.getElementById('forwarding-dispatch-number');
  const fwdRemarksInput      = document.getElementById('forwarding-remarks');

  const sectionAtrStatus     = document.getElementById('section-atr-status');
  const atrStatusSelect      = document.getElementById('atr-status');
  const atrReceiptDateInput  = document.getElementById('atr-receipt-date');
  const atrRefNumberInput    = document.getElementById('atr-reference-number');
  const atrRemarksInput      = document.getElementById('atr-remarks');

  const sectionAtrSubmitted  = document.getElementById('section-atr-submitted');
  const atrSubDateInput      = document.getElementById('atr-submission-date');
  const atrSubmittedToInput  = document.getElementById('atr-submitted-to');
  const atrDispatchInput     = document.getElementById('atr-dispatch-number');
  const atrSubRemarksInput   = document.getElementById('atr-submission-remarks');

  const workflowRemarksInput = document.getElementById('workflow-remarks');

  // Error Elements
  const eofficeFileError     = document.getElementById('eoffice-file-error');
  const commError            = document.getElementById('comm-error');
  const repError             = document.getElementById('representation-error');
  const workflowTypeError    = document.getElementById('workflow-type-error');

  // Info Pills
  const eofficeInfoPill      = document.getElementById('eoffice-info-pill');
  const pillCompNo           = document.getElementById('pill-comp-no');
  const pillFileNo           = document.getElementById('pill-file-no');

  const repInfoPill          = document.getElementById('representation-info-pill');
  const pillRepSerial        = document.getElementById('pill-rep-serial');
  const pillRepApplicant     = document.getElementById('pill-rep-applicant');
  const pillRepChannel       = document.getElementById('pill-rep-channel');
  const pillRepSubject       = document.getElementById('pill-rep-subject');

  // Filter Elements
  const filterWorkflowType   = document.getElementById('filter-workflow-type');
  const filterChannel        = document.getElementById('filter-channel');
  const filterCommNumber     = document.getElementById('filter-comm-number');
  const filterSerialNumber   = document.getElementById('filter-serial-number');
  const btnResetFilters      = document.getElementById('btn-reset-filters');

  // Tabs & Counts
  const tabActive            = document.getElementById('tab-active');
  const tabArchive           = document.getElementById('tab-archive');
  const activeBadge          = document.getElementById('active-badge');
  const archiveBadge         = document.getElementById('archive-badge');
  const tableTitleText       = document.getElementById('table-title-text');
  const colHeaderDate        = document.getElementById('col-header-date');
  const refreshBtn           = document.getElementById('refresh-btn');

  // Confirmation Modal
  const confirmModal         = document.getElementById('confirm-modal');
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
      setupFilterListeners();
      setupTableActionListeners();

      pageShell.style.display = 'flex';
      hideLoading();

      // Pre-load E-Office Files dropdown reference data (chunked range pagination)
      await loadEofficeFilesDropdown();

      // Initialize DataTables & badge counts
      initDataTable();
      await updateBadgeCounts();

    } catch (err) {
      console.error('Workflow page init error:', err);
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
   *  SORTING HELPERS (Descending: Highest to Lowest)
   * ═════════════════════════════════════════════════════════════════════ */
  function compareDescending(valA, valB) {
    const strA = valA != null ? String(valA).trim() : '';
    const strB = valB != null ? String(valB).trim() : '';

    if (!strA && !strB) return 0;
    if (!strA) return 1;
    if (!strB) return -1;

    const numA = Number(strA);
    const numB = Number(strB);
    const isNumA = !isNaN(numA) && strA !== '';
    const isNumB = !isNaN(numB) && strB !== '';

    if (isNumA && isNumB) {
      if (numB !== numA) return numB - numA;
    }

    return strB.localeCompare(strA, undefined, { numeric: true, sensitivity: 'base' });
  }

  function compareEofficeFilesDescending(a, b) {
    const compA = a.e_office_computer_number ? String(a.e_office_computer_number).trim() : '';
    const compB = b.e_office_computer_number ? String(b.e_office_computer_number).trim() : '';

    if (compA && compB) {
      const cmp = compareDescending(compA, compB);
      if (cmp !== 0) return cmp;
      return compareDescending(a.e_office_file_number, b.e_office_file_number);
    }
    if (compA && !compB) return -1;
    if (!compA && compB) return 1;
    return compareDescending(a.e_office_file_number, b.e_office_file_number);
  }

  function compareCommunicationsDescending(a, b) {
    const cmp = compareDescending(a.communication_number, b.communication_number);
    if (cmp !== 0) return cmp;
    return compareDescending(a.communication_date, b.communication_date);
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DROPDOWN DATA LOADERS (Chunked Pagination to load all 2,840+ files)
   * ═════════════════════════════════════════════════════════════════════ */
  async function loadEofficeFilesDropdown() {
    try {
      const client = getSupabaseClient();
      const allFiles = [];
      const CHUNK_SIZE = 1000;
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await client
          .from('e_office_files')
          .select('uuid, e_office_computer_number, e_office_file_number')
          .eq('is_deleted', false)
          .range(from, from + CHUNK_SIZE - 1);

        if (error) {
          console.error('Error fetching e_office_files chunk:', error);
          break;
        }

        if (data && data.length > 0) {
          allFiles.push(...data);
          if (data.length < CHUNK_SIZE) hasMore = false;
          else from += CHUNK_SIZE;
        } else {
          hasMore = false;
        }
      }

      eOfficeFilesList = allFiles.sort(compareEofficeFilesDescending);
      populateEofficeSelect();

    } catch (err) {
      console.error('Network error loading E-Office files:', err);
    }
  }

  function populateEofficeSelect(selectedUuid = '') {
    eOfficeFilesList.sort(compareEofficeFilesDescending);
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
      resetRepDropdown();
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
        .eq('is_deleted', false);

      if (error) {
        console.error('Error loading communications:', error);
        selectCommNumber.innerHTML = '<option value="">-- Failed to load communications --</option>';
        return;
      }

      currentFileCommsList = (data || []).sort(compareCommunicationsDescending);

      if (currentFileCommsList.length === 0) {
        selectCommNumber.innerHTML = '<option value="">-- No communications found for this file --</option>';
        selectCommNumber.disabled = false;
        resetRepDropdown();
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

  async function loadRepresentationsForComm(commUuid, preselectedRepUuid = '') {
    if (!commUuid) {
      resetRepDropdown();
      return;
    }

    selectRepresentation.disabled = true;
    selectRepresentation.innerHTML = '<option value="">-- Loading representations... --</option>';

    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('registered_representations')
        .select('uuid, representation_serial_number, applicant_name, representation_subject, processing_channel')
        .eq('received_communications_uuid', commUuid)
        .eq('is_deleted', false)
        .order('representation_serial_number', { ascending: true });

      if (error) {
        console.error('Error loading representations for comm:', error);
        selectRepresentation.innerHTML = '<option value="">-- Failed to load representations --</option>';
        return;
      }

      currentCommRepsList = data || [];

      if (currentCommRepsList.length === 0) {
        selectRepresentation.innerHTML = '<option value="">-- No representations registered for this communication --</option>';
        selectRepresentation.disabled = false;
        repInfoPill.style.display = 'none';
        return;
      }

      selectRepresentation.innerHTML = '<option value="">-- Choose Representation --</option>';
      currentCommRepsList.forEach(rep => {
        const opt = document.createElement('option');
        opt.value = rep.uuid;
        const sNo = rep.representation_serial_number != null ? `S.No. ${rep.representation_serial_number}` : 'S.No. ?';
        const appName = rep.applicant_name ? ` — ${rep.applicant_name}` : '';
        const subj = rep.representation_subject ? ` (${rep.representation_subject.slice(0, 40)}…)` : '';
        opt.textContent = `${sNo}${appName}${subj}`;
        if (rep.uuid === preselectedRepUuid) opt.selected = true;
        selectRepresentation.appendChild(opt);
      });

      selectRepresentation.disabled = false;

    } catch (err) {
      console.error('Network error loading representations:', err);
      selectRepresentation.innerHTML = '<option value="">-- Network error loading representations --</option>';
    }
  }

  function resetRepDropdown() {
    selectRepresentation.innerHTML = '<option value="">-- Select a Communication first --</option>';
    selectRepresentation.disabled = true;
    currentCommRepsList = [];
    repInfoPill.style.display = 'none';

    regRepUuidInp.value = '';
    repSerialInp.value = '';
    applicantNameInp.value = '';
    subjectInp.value = '';
    processingChannelInp.value = '';
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  FORM LISTENERS & CASCADING SELECTIONS
   * ═════════════════════════════════════════════════════════════════════ */
  function setupFormListeners() {
    // 1. E-Office File selection change
    selectEofficeFile.addEventListener('change', async () => {
      clearFieldError(selectEofficeFile, eofficeFileError);
      clearFieldError(selectCommNumber, commError);
      clearFieldError(selectRepresentation, repError);

      const selectedUuid = selectEofficeFile.value;
      if (!selectedUuid) {
        eOfficeFilesUuidInp.value = '';
        eOfficeCompNumInp.value = '';
        eOfficeFileNumInp.value = '';
        commUuidInp.value = '';
        commNumInp.value = '';
        commDateInp.value = '';

        eofficeInfoPill.style.display = 'none';
        selectCommNumber.innerHTML = '<option value="">-- Select an E-Office File first --</option>';
        selectCommNumber.disabled = true;
        resetRepDropdown();
        return;
      }

      const file = eOfficeFilesList.find(f => f.uuid === selectedUuid);
      if (file) {
        eOfficeFilesUuidInp.value = file.uuid;
        eOfficeCompNumInp.value = file.e_office_computer_number || '';
        eOfficeFileNumInp.value = file.e_office_file_number || '';

        pillCompNo.textContent = file.e_office_computer_number || '—';
        pillFileNo.textContent = file.e_office_file_number || '—';
        eofficeInfoPill.style.display = 'flex';
      }

      commUuidInp.value = '';
      commNumInp.value = '';
      commDateInp.value = '';
      resetRepDropdown();

      await loadCommunicationsForFile(selectedUuid);
    });

    // 2. Communication Number change
    selectCommNumber.addEventListener('change', async () => {
      clearFieldError(selectCommNumber, commError);
      clearFieldError(selectRepresentation, repError);

      const selectedCommUuid = selectCommNumber.value;
      if (!selectedCommUuid) {
        commUuidInp.value = '';
        commNumInp.value = '';
        commDateInp.value = '';
        resetRepDropdown();
        return;
      }

      const comm = currentFileCommsList.find(c => c.uuid === selectedCommUuid);
      if (comm) {
        commUuidInp.value = comm.uuid;
        commNumInp.value = comm.communication_number || '';
        commDateInp.value = comm.communication_date || '';
      }

      resetRepDropdown();
      await loadRepresentationsForComm(selectedCommUuid);
    });

    // 3. Representation selection change
    selectRepresentation.addEventListener('change', () => {
      clearFieldError(selectRepresentation, repError);
      const selectedRepUuid = selectRepresentation.value;
      if (!selectedRepUuid) {
        repInfoPill.style.display = 'none';
        regRepUuidInp.value = '';
        repSerialInp.value = '';
        applicantNameInp.value = '';
        subjectInp.value = '';
        processingChannelInp.value = '';
        return;
      }

      const rep = currentCommRepsList.find(r => r.uuid === selectedRepUuid);
      if (rep) {
        regRepUuidInp.value = rep.uuid;
        repSerialInp.value = rep.representation_serial_number != null ? rep.representation_serial_number : '';
        applicantNameInp.value = rep.applicant_name || '';
        subjectInp.value = rep.representation_subject || '';
        processingChannelInp.value = rep.processing_channel || '';

        pillRepSerial.textContent = `S. No. ${rep.representation_serial_number || '?'}`;
        pillRepApplicant.textContent = rep.applicant_name || 'Anonymous';
        pillRepChannel.textContent = rep.processing_channel || 'Channel';
        pillRepSubject.textContent = rep.representation_subject || 'No subject description';
        repInfoPill.style.display = 'flex';
      }
    });

    // 4. Workflow Type selection change -> Toggle Dynamic Sections
    workflowTypeSelect.addEventListener('change', () => {
      clearFieldError(workflowTypeSelect, workflowTypeError);
      updateWorkflowSections(workflowTypeSelect.value);
    });

    // Submit & Cancel
    formSubmitBtn.addEventListener('click', handleFormSubmit);
    formCancelBtn.addEventListener('click', closeFormModal);
  }

  function updateWorkflowSections(type) {
    sectionForward.style.display = (type === 'Forward to Concerned') ? 'block' : 'none';
    sectionAtrStatus.style.display = (type === 'ATR Status') ? 'block' : 'none';
    sectionAtrSubmitted.style.display = (type === 'ATR Submitted to Original Source') ? 'block' : 'none';
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


  /* ═════════════════════════════════════════════════════════════════════
   *  MODAL OPEN & CLOSE
   * ═════════════════════════════════════════════════════════════════════ */
  async function openCreateModal() {
    isEditMode = false;
    resetForm();
    formModalTitleText.textContent = 'Add New Workflow Record';
    formSubmitBtnText.textContent = 'Save Workflow Record';
    await loadEofficeFilesDropdown();
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
          showToast('Unable to load workflow record.', 'error');
          return;
        }
        record = data;
      } catch (err) {
        hideLoading();
        showToast('Network error loading workflow record.', 'error');
        return;
      }
    }
    hideLoading();

    isEditMode = true;
    resetForm();
    formModalTitleText.textContent = 'Edit Workflow Record';
    formSubmitBtnText.textContent = 'Update Workflow Record';

    // Populate hidden inputs
    editUuidInput.value = record.uuid;
    eOfficeFilesUuidInp.value = record.e_office_files_uuid;
    eOfficeCompNumInp.value = record.e_office_computer_number || '';
    eOfficeFileNumInp.value = record.e_office_file_number || '';
    commUuidInp.value = record.received_communications_uuid;
    commNumInp.value = record.communication_number || '';
    commDateInp.value = record.communication_date || '';
    regRepUuidInp.value = record.registered_representations_uuid || '';
    repSerialInp.value = record.representation_serial_number != null ? record.representation_serial_number : '';
    applicantNameInp.value = record.applicant_name || '';
    subjectInp.value = record.representation_subject || '';
    processingChannelInp.value = record.processing_channel || '';

    // 1. Select E-Office File
    if (eOfficeFilesList.length === 0) await loadEofficeFilesDropdown();
    populateEofficeSelect(record.e_office_files_uuid);
    pillCompNo.textContent = record.e_office_computer_number || '—';
    pillFileNo.textContent = record.e_office_file_number || '—';
    eofficeInfoPill.style.display = 'flex';

    // 2. Load and Select Communication Number
    await loadCommunicationsForFile(record.e_office_files_uuid, record.received_communications_uuid);

    // 3. Load and Select Representation
    await loadRepresentationsForComm(record.received_communications_uuid, record.registered_representations_uuid);
    pillRepSerial.textContent = `S. No. ${record.representation_serial_number || '?'}`;
    pillRepApplicant.textContent = record.applicant_name || 'Anonymous';
    pillRepChannel.textContent = record.processing_channel || 'Channel';
    pillRepSubject.textContent = record.representation_subject || 'No subject';
    repInfoPill.style.display = 'flex';

    // 4. Workflow Type & Sections
    workflowTypeSelect.value = record.workflow_type || '';
    updateWorkflowSections(record.workflow_type);

    // 5. Processing Channel ID Number
    channelIdNumberInput.value = record.processing_channel_id_number || '';

    // 6. Workflow Specific Fields
    fwdDepartmentInput.value = record.forwarded_to_department || '';
    fwdDateInput.value = record.forwarding_date || '';
    fwdDispatchInput.value = record.forwarding_dispatch_number || '';
    fwdRemarksInput.value = record.forwarding_remarks || '';

    atrStatusSelect.value = record.atr_status || '';
    atrReceiptDateInput.value = record.atr_receipt_date || '';
    atrRefNumberInput.value = record.atr_reference_number || '';
    atrRemarksInput.value = record.atr_remarks || '';

    atrSubDateInput.value = record.atr_submission_date || '';
    atrSubmittedToInput.value = record.atr_submitted_to || '';
    atrDispatchInput.value = record.atr_dispatch_number || '';
    atrSubRemarksInput.value = record.atr_submission_remarks || '';

    workflowRemarksInput.value = record.remarks || '';

    formModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeFormModal() {
    formModal.classList.remove('open');
    document.body.style.overflow = '';
    resetForm();
  }

  function resetForm() {
    workflowForm.reset();
    editUuidInput.value = '';
    eOfficeFilesUuidInp.value = '';
    eOfficeCompNumInp.value = '';
    eOfficeFileNumInp.value = '';
    commUuidInp.value = '';
    commNumInp.value = '';
    commDateInp.value = '';
    regRepUuidInp.value = '';
    repSerialInp.value = '';
    applicantNameInp.value = '';
    subjectInp.value = '';
    processingChannelInp.value = '';

    eofficeInfoPill.style.display = 'none';
    repInfoPill.style.display = 'none';

    selectCommNumber.innerHTML = '<option value="">-- Select an E-Office File first --</option>';
    selectCommNumber.disabled = true;
    resetRepDropdown();

    updateWorkflowSections('');

    [
      selectEofficeFile, selectCommNumber, selectRepresentation, workflowTypeSelect
    ].forEach(inp => {
      if (inp) inp.classList.remove('invalid');
    });

    [
      eofficeFileError, commError, repError, workflowTypeError
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

    // 1. E-Office File
    const eOfficeUuid = selectEofficeFile.value;
    if (!eOfficeUuid) {
      showFieldError(selectEofficeFile, eofficeFileError);
      valid = false;
    } else {
      clearFieldError(selectEofficeFile, eofficeFileError);
    }

    // 2. Communication Number
    const commUuid = selectCommNumber.value;
    if (!commUuid) {
      showFieldError(selectCommNumber, commError);
      valid = false;
    } else {
      clearFieldError(selectCommNumber, commError);
    }

    // 3. Representation
    const repUuid = selectRepresentation.value;
    if (!repUuid) {
      showFieldError(selectRepresentation, repError);
      valid = false;
    } else {
      clearFieldError(selectRepresentation, repError);
    }

    // 4. Workflow Type
    const wfType = workflowTypeSelect.value;
    if (!wfType) {
      showFieldError(workflowTypeSelect, workflowTypeError);
      valid = false;
    } else {
      clearFieldError(workflowTypeSelect, workflowTypeError);
    }

    if (!valid) {
      showToast('Please correct highlighted fields before submitting.', 'error');
      return;
    }

    // Prepare payload
    setFormLoading(true);

    const payload = {
      e_office_files_uuid: eOfficeUuid,
      e_office_computer_number: eOfficeCompNumInp.value.trim(),
      e_office_file_number: eOfficeFileNumInp.value.trim(),
      received_communications_uuid: commUuid,
      communication_number: commNumInp.value.trim(),
      communication_date: commDateInp.value || null,
      registered_representations_uuid: repUuid || null,
      representation_serial_number: parseInt(repSerialInp.value, 10) || 0,
      applicant_name: applicantNameInp.value.trim(),
      representation_subject: subjectInp.value.trim(),
      processing_channel: processingChannelInp.value.trim(),
      processing_channel_id_number: channelIdNumberInput.value.trim() || null,
      workflow_type: wfType,

      // Workflow Specific Fields
      forwarded_to_department: (wfType === 'Forward to Concerned') ? (fwdDepartmentInput.value.trim() || null) : null,
      forwarding_date: (wfType === 'Forward to Concerned') ? (fwdDateInput.value || null) : null,
      forwarding_dispatch_number: (wfType === 'Forward to Concerned') ? (fwdDispatchInput.value.trim() || null) : null,
      forwarding_remarks: (wfType === 'Forward to Concerned') ? (fwdRemarksInput.value.trim() || null) : null,

      atr_status: (wfType === 'ATR Status') ? (atrStatusSelect.value || null) : null,
      atr_receipt_date: (wfType === 'ATR Status') ? (atrReceiptDateInput.value || null) : null,
      atr_reference_number: (wfType === 'ATR Status') ? (atrRefNumberInput.value.trim() || null) : null,
      atr_remarks: (wfType === 'ATR Status') ? (atrRemarksInput.value.trim() || null) : null,

      atr_submission_date: (wfType === 'ATR Submitted to Original Source') ? (atrSubDateInput.value || null) : null,
      atr_submitted_to: (wfType === 'ATR Submitted to Original Source') ? (atrSubmittedToInput.value.trim() || null) : null,
      atr_dispatch_number: (wfType === 'ATR Submitted to Original Source') ? (atrDispatchInput.value.trim() || null) : null,
      atr_submission_remarks: (wfType === 'ATR Submitted to Original Source') ? (atrSubRemarksInput.value.trim() || null) : null,

      remarks: workflowRemarksInput.value.trim() || null,
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

        showToast('Workflow record updated successfully.', 'success');

      } else {
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

        showToast('Workflow record created successfully.', 'success');
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
      console.error('Submission error:', err);
      showToast('An unexpected error occurred while saving.', 'error');
      setFormLoading(false);
    }
  }

  function handleDbError(error, action) {
    console.error(`DB error on ${action}:`, error);
    showToast(`Failed to ${action} workflow record: ` + (error.message || 'Database error'), 'error');
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  TAB SWITCHING & BADGE COUNTS
   * ═════════════════════════════════════════════════════════════════════ */
  function setupTabListeners() {
    tabActive.addEventListener('click', () => switchView('active'));
    tabArchive.addEventListener('click', () => switchView('archive'));
  }

  function switchView(newView) {
    if (currentView === newView) return;

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
      tableTitleText.textContent = 'Active Workflow Records';
      if (colHeaderDate) colHeaderDate.textContent = 'Created At';
    } else {
      tabArchive.classList.add('active');
      tabArchive.setAttribute('aria-selected', 'true');
      tabActive.classList.remove('active');
      tabActive.setAttribute('aria-selected', 'false');
      tableTitleText.textContent = 'Archived Workflow Records';
      if (colHeaderDate) colHeaderDate.textContent = 'Archived At';
    }

    if (dataTableInstance) {
      const saved = listState[newView];
      dataTableInstance.search(saved.search || '');
      if (saved.length) dataTableInstance.page.len(saved.length);

      dataTableInstance.ajax.reload(() => {
        if (saved.page) dataTableInstance.page(saved.page).draw('page');
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
   *  FILTERS SETUP
   * ═════════════════════════════════════════════════════════════════════ */
  function setupFilterListeners() {
    filterWorkflowType.addEventListener('change', () => {
      filters.workflowType = filterWorkflowType.value;
      if (dataTableInstance) dataTableInstance.ajax.reload();
    });

    filterChannel.addEventListener('change', () => {
      filters.channel = filterChannel.value;
      if (dataTableInstance) dataTableInstance.ajax.reload();
    });

    let debounceTimer;
    filterCommNumber.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        filters.commNumber = filterCommNumber.value.trim();
        if (dataTableInstance) dataTableInstance.ajax.reload();
      }, 300);
    });

    filterSerialNumber.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        filters.serialNumber = filterSerialNumber.value.trim();
        if (dataTableInstance) dataTableInstance.ajax.reload();
      }, 300);
    });

    btnResetFilters.addEventListener('click', () => {
      filterWorkflowType.value = '';
      filterChannel.value = '';
      filterCommNumber.value = '';
      filterSerialNumber.value = '';

      filters.workflowType = '';
      filters.channel = '';
      filters.commNumber = '';
      filters.serialNumber = '';

      if (dataTableInstance) {
        dataTableInstance.search('');
        dataTableInstance.ajax.reload();
      }
    });

    refreshBtn.addEventListener('click', () => {
      if (dataTableInstance) dataTableInstance.ajax.reload(null, false);
      updateBadgeCounts();
    });
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
        searchPlaceholder: 'Search applicant, subject, department, number…',
        lengthMenu: 'Show _MENU_ records',
        info: 'Showing _START_ to _END_ of _TOTAL_ workflow records',
        infoEmpty: 'No workflow records found',
        infoFiltered: '(filtered from _MAX_ total)',
        emptyTable: 'No workflow records found matching current criteria',
        zeroRecords: 'No matching workflow records found',
        processing: '<div class="table-spinner"></div> Loading records…'
      },
      ajax: async function (data, callback) {
        try {
          const client = getSupabaseClient();
          const start = data.start;
          const length = data.length;
          const searchValue = (data.search?.value || '').trim();
          const isDeletedView = (currentView === 'archive');

          let query = client
            .from(DB_TABLE)
            .select('*', { count: 'exact' })
            .eq('is_deleted', isDeletedView);

          // Apply Filter Panel controls
          if (filters.workflowType) {
            query = query.eq('workflow_type', filters.workflowType);
          }
          if (filters.channel) {
            query = query.eq('processing_channel', filters.channel);
          }
          if (filters.commNumber) {
            query = query.ilike('communication_number', `%${filters.commNumber}%`);
          }
          if (filters.serialNumber) {
            const sNum = parseInt(filters.serialNumber, 10);
            if (!isNaN(sNum)) query = query.eq('representation_serial_number', sNum);
          }

          // Global Search bar
          if (searchValue) {
            query = query.or(
              `applicant_name.ilike.%${searchValue}%,` +
              `representation_subject.ilike.%${searchValue}%,` +
              `communication_number.ilike.%${searchValue}%,` +
              `e_office_computer_number.ilike.%${searchValue}%,` +
              `e_office_file_number.ilike.%${searchValue}%,` +
              `processing_channel_id_number.ilike.%${searchValue}%,` +
              `forwarded_to_department.ilike.%${searchValue}%,` +
              `forwarding_dispatch_number.ilike.%${searchValue}%,` +
              `atr_reference_number.ilike.%${searchValue}%,` +
              `atr_submitted_to.ilike.%${searchValue}%,` +
              `atr_dispatch_number.ilike.%${searchValue}%`
            );
          }

          // Sorting
          if (data.order && data.order.length > 0) {
            const colIdx = data.order[0].column;
            const sortDir = data.order[0].dir;
            const dbColumn = COLUMN_DB_MAP[colIdx] || 'created_at';
            query = query.order(dbColumn, { ascending: (sortDir === 'asc'), nullsFirst: false });
          } else {
            query = query.order('created_at', { ascending: false });
          }

          // Pagination range
          query = query.range(start, start + length - 1);

          const { data: records, error, count } = await query;

          if (error) {
            console.error('DataTables query error:', error);
            showToast('Error loading workflow records: ' + error.message, 'error');
            callback({
              draw: data.draw,
              recordsTotal: 0,
              recordsFiltered: 0,
              data: []
            });
            return;
          }

          currentRecords = records || [];

          // Format rows for DataTables
          const rows = currentRecords.map((r, index) => {
            const sNo = start + index + 1;

            // Workflow type badge
            let typeBadgeClass = 'forward';
            if (r.workflow_type === 'ATR Status') typeBadgeClass = 'atr-status';
            else if (r.workflow_type === 'ATR Submitted to Original Source') typeBadgeClass = 'atr-submitted';

            const typeBadgeHtml = `<span class="wf-type-badge ${typeBadgeClass}">${escapeHtml(r.workflow_type || '—')}</span>`;

            // E-Office File column
            const compNo = r.e_office_computer_number || 'No Comp #';
            const fileNo = r.e_office_file_number || 'No File #';
            const eOfficeHtml = `<strong>${escapeHtml(compNo)}</strong><br/><span style="color:var(--clr-text-dim);font-size:0.8rem;">${escapeHtml(fileNo)}</span>`;

            // Comm Number & Date
            const commNum = r.communication_number || '—';
            const commDate = r.communication_date ? formatDateOnly(r.communication_date) : '';
            const commHtml = `<span>${escapeHtml(commNum)}</span>${commDate ? `<br/><span style="color:var(--clr-text-dim);font-size:0.78rem;">${commDate}</span>` : ''}`;

            // Rep Serial Number
            const repSerial = r.representation_serial_number != null ? `<strong style="color:var(--clr-primary-hover);">#${r.representation_serial_number}</strong>` : '—';

            // Channel & ID
            const channelBadge = `<span class="channel-badge">${escapeHtml(r.processing_channel || '—')}</span>`;
            const channelIdTag = r.processing_channel_id_number ? `<span class="channel-id-tag">ID: ${escapeHtml(r.processing_channel_id_number)}</span>` : '';
            const channelColHtml = `${channelBadge}${channelIdTag}`;

            // Workflow Action Details summary
            let actionDetailsHtml = '—';
            if (r.workflow_type === 'Forward to Concerned') {
              const dept = r.forwarded_to_department ? `<strong>Dept:</strong> ${escapeHtml(r.forwarded_to_department)}` : '';
              const fDate = r.forwarding_date ? ` (${formatDateOnly(r.forwarding_date)})` : '';
              const disp = r.forwarding_dispatch_number ? `<br/><span style="font-size:0.78rem;color:var(--clr-text-dim);">Ref: ${escapeHtml(r.forwarding_dispatch_number)}</span>` : '';
              actionDetailsHtml = `${dept}${fDate}${disp}`;
            } else if (r.workflow_type === 'ATR Status') {
              const status = r.atr_status ? `<strong>Status:</strong> <span style="color:#fcd34d;">${escapeHtml(r.atr_status)}</span>` : '';
              const recDate = r.atr_receipt_date ? ` (${formatDateOnly(r.atr_receipt_date)})` : '';
              const ref = r.atr_reference_number ? `<br/><span style="font-size:0.78rem;color:var(--clr-text-dim);">Ref: ${escapeHtml(r.atr_reference_number)}</span>` : '';
              actionDetailsHtml = `${status}${recDate}${ref}`;
            } else if (r.workflow_type === 'ATR Submitted to Original Source') {
              const to = r.atr_submitted_to ? `<strong>To:</strong> ${escapeHtml(r.atr_submitted_to)}` : '';
              const subDate = r.atr_submission_date ? ` (${formatDateOnly(r.atr_submission_date)})` : '';
              const disp = r.atr_dispatch_number ? `<br/><span style="font-size:0.78rem;color:var(--clr-text-dim);">Disp: ${escapeHtml(r.atr_dispatch_number)}</span>` : '';
              actionDetailsHtml = `${to}${subDate}${disp}`;
            }

            // Subject truncated with tooltip
            const fullSubject = r.representation_subject || '—';
            const shortSubject = fullSubject.length > 55 ? `${fullSubject.slice(0, 55)}…` : fullSubject;
            const subjectHtml = `<span title="${escapeHtml(fullSubject)}">${escapeHtml(shortSubject)}</span>`;

            // Date
            const targetDate = isDeletedView ? (r.deleted_at || r.updated_at) : r.created_at;
            const dateFormatted = targetDate ? formatDate(targetDate) : '—';

            // Actions
            const actionsHtml = !isDeletedView
              ? `<div class="action-btns">
                  <button class="action-btn edit-btn" title="Edit Workflow Record" aria-label="Edit record" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button class="action-btn delete-btn" title="Archive / Delete" aria-label="Archive record" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                </div>`
              : `<div class="action-btns">
                  <button class="action-btn restore-btn" title="Restore to Active" aria-label="Restore record" data-uuid="${r.uuid}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                    </svg>
                  </button>
                </div>`;

            return [
              sNo,
              typeBadgeHtml,
              eOfficeHtml,
              commHtml,
              repSerial,
              escapeHtml(r.applicant_name || '—'),
              channelColHtml,
              actionDetailsHtml,
              subjectHtml,
              dateFormatted,
              actionsHtml
            ];
          });

          callback({
            draw: data.draw,
            recordsTotal: count || 0,
            recordsFiltered: count || 0,
            data: rows
          });

        } catch (err) {
          console.error('Ajax exception in DataTables:', err);
          callback({ draw: data.draw, recordsTotal: 0, recordsFiltered: 0, data: [] });
        }
      },
      columns: [
        { orderable: false, width: '45px' },   // 0: S.No.
        { orderable: true },                  // 1: Workflow Type
        { orderable: true },                  // 2: E-Office File
        { orderable: true },                  // 3: Comm. Number
        { orderable: true },                  // 4: Rep. Serial No.
        { orderable: true },                  // 5: Applicant Name
        { orderable: true },                  // 6: Channel & ID
        { orderable: false },                 // 7: Action Details
        { orderable: true },                  // 8: Subject
        { orderable: true, width: '130px' },  // 9: Created At
        { orderable: false, width: '90px' }   // 10: Actions
      ]
    });
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  TABLE ACTIONS & CONFIRMATION (Delete / Restore)
   * ═════════════════════════════════════════════════════════════════════ */
  function setupTableActionListeners() {
    const tableBody = document.querySelector('#data-table tbody');
    if (!tableBody) return;

    tableBody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-btn');
      if (editBtn) {
        const uuid = editBtn.getAttribute('data-uuid');
        if (uuid) openEditModal(uuid);
        return;
      }

      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        const uuid = deleteBtn.getAttribute('data-uuid');
        if (uuid) openConfirmModal('delete', uuid);
        return;
      }

      const restoreBtn = e.target.closest('.restore-btn');
      if (restoreBtn) {
        const uuid = restoreBtn.getAttribute('data-uuid');
        if (uuid) openConfirmModal('restore', uuid);
        return;
      }
    });
  }

  function openConfirmModal(action, uuid) {
    confirmAction = action;
    confirmTargetUuid = uuid;

    const record = currentRecords.find(r => r.uuid === uuid);
    const identifier = record
      ? `(${record.workflow_type} for Rep #${record.representation_serial_number || '?'})`
      : '';

    if (action === 'delete') {
      confirmTitleText.textContent = 'Archive Workflow Record';
      confirmModalMessage.textContent = `Are you sure you want to archive this workflow record ${identifier}? It can be restored later from the Archive List.`;
      confirmActionText.textContent = 'Archive';
      confirmActionBtn.className = 'btn btn-danger';
    } else {
      confirmTitleText.textContent = 'Restore Workflow Record';
      confirmModalMessage.textContent = `Are you sure you want to restore this workflow record ${identifier} back to the Active List?`;
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
          const { error } = await client
            .from(DB_TABLE)
            .update({
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              deleted_by: userUuid
            })
            .eq('uuid', confirmTargetUuid);

          if (error) throw error;
          showToast('Workflow record archived successfully.', 'success');

        } else if (confirmAction === 'restore') {
          const { error } = await client
            .from(DB_TABLE)
            .update({
              is_deleted: false,
              deleted_at: null,
              deleted_by: null
            })
            .eq('uuid', confirmTargetUuid);

          if (error) throw error;
          showToast('Workflow record restored successfully.', 'success');
        }

        closeConfirmModal();
        if (dataTableInstance) dataTableInstance.ajax.reload(null, false);
        await updateBadgeCounts();

      } catch (err) {
        console.error('Confirm action error:', err);
        showToast('Operation failed: ' + (err.message || 'Network error'), 'error');
        confirmActionBtn.classList.remove('loading');
        confirmActionBtn.disabled = false;
      }
    });
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  UTILITY HELPERS
   * ═════════════════════════════════════════════════════════════════════ */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return isoStr;
    }
  }

  function formatDateOnly(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
      return dateStr;
    }
  }

  function getInitials(name) {
    if (!name) return '?';
    return name
      .trim()
      .split(/\s+/)
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

})();
