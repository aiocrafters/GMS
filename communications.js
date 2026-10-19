/* =====================================================================
 *  communications.js — Communications Management Behaviour
 *  Handles E-Office file & Department fetching, auto-derived fields,
 *  validation, CRUD operations, paginated table, search & modals.
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
  let currentRecords = [];           // current page rows
  let totalCount = 0;                // total records matching query
  let currentPage = 1;
  let isEditMode = false;
  let deleteTargetUuid = null;
  let searchTimer = null;

  /* ── DOM refs ── */
  const pageShell            = document.getElementById('page-shell');
  const logoutBtn            = document.getElementById('logout-btn');

  // Form DOM refs
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
  const formTitleText        = document.getElementById('form-title-text');

  // Error labels
  const eofficeFileErr       = document.getElementById('eoffice-file-error');
  const commNumErr           = document.getElementById('comm-number-error');
  const commDateErr          = document.getElementById('comm-date-error');
  const receivedFromErr      = document.getElementById('received-from-error');
  const commSubjectErr       = document.getElementById('comm-subject-error');

  // Table & Toolbar DOM refs
  const searchInput          = document.getElementById('search-input');
  const refreshBtn           = document.getElementById('refresh-btn');
  const tableBody            = document.getElementById('table-body');
  const recordCountEl        = document.getElementById('record-count');
  const paginationEl         = document.getElementById('pagination');

  // Delete modal DOM refs
  const deleteModal          = document.getElementById('delete-modal');
  const modalMsg             = document.getElementById('modal-message');
  const modalCancelBtn       = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn      = document.getElementById('modal-confirm-btn');


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
      pageShell.style.display = 'flex';
      hideLoading();

      // Load reference data in parallel
      await Promise.all([
        loadEofficeFilesDropdown(),
        loadDepartmentsDropdown()
      ]);

      // Load initial communications table
      await loadCommunications();

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

    // Cancel Button
    cancelBtn.addEventListener('click', resetForm);

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
          return;
        }

        showToast('Communication record updated successfully.', 'success');

      } else {
        /* ── INSERT ── */
        payload.created_by = currentProfile?.email || currentUser.email || 'System';
        payload.created_at = new Date().toISOString();

        const { error } = await client
          .from('communications')
          .insert(payload);

        if (error) {
          showToast('Failed to create record: ' + error.message, 'error');
          setFormLoading(false);
          return;
        }

        showToast('Communication record created successfully.', 'success');
      }

      resetForm();
      setFormLoading(false);
      await loadCommunications();

    } catch (err) {
      console.error('Error submitting form:', err);
      showToast('Network error saving communication.', 'error');
      setFormLoading(false);
    }
  }

  function resetForm() {
    form.reset();
    editUuidInput.value = '';
    eofficeUuidInput.value = '';
    isEditMode = false;

    formTitleText.textContent = 'New Communication Record';
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
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DATA TABLE — Fetch, Render, Search, Paginate (18 Columns)
   * ═════════════════════════════════════════════════════════════════════ */

  async function loadCommunications() {
    renderTableLoading();
    refreshBtn.classList.add('spinning');

    try {
      const client = getSupabaseClient();
      const start = (currentPage - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      let query = client
        .from('communications')
        .select('*', { count: 'exact' });

      const q = searchInput.value.trim();
      if (q) {
        // Search across key columns
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

      currentRecords = data || [];
      totalCount = count || 0;

      // Ensure page doesn't overshoot
      const maxPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      if (currentPage > maxPage) {
        currentPage = maxPage;
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
  refreshBtn.addEventListener('click', () => loadCommunications());

  // Search (debounced)
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      loadCommunications();
    }, 300);
  });

  function renderTable() {
    const start = (currentPage - 1) * PAGE_SIZE;

    if (currentRecords.length === 0) {
      const msg = searchInput.value.trim()
        ? `No communications match "${searchInput.value}".`
        : 'No communication records available.';
      renderTableEmpty(msg);
      return;
    }

    tableBody.innerHTML = currentRecords.map((r, i) => {
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

      const totalRep = r.total_representations || 0;
      const grievPortal = r.grievances_portal || 0;
      const deptChannels = r.departmental_channels || 0;
      const nonActionable = r.non_actionable || 0;

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
          <td>
            <div class="action-btns">
              <button class="action-btn edit-btn" title="Edit" aria-label="Edit record" data-uuid="${r.uuid}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="action-btn delete-btn" title="Delete" aria-label="Delete record" data-uuid="${r.uuid}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Attach row action listeners
    tableBody.querySelectorAll('.edit-btn').forEach(btn =>
      btn.addEventListener('click', () => startEdit(btn.dataset.uuid))
    );
    tableBody.querySelectorAll('.delete-btn').forEach(btn =>
      btn.addEventListener('click', () => confirmDelete(btn.dataset.uuid))
    );
  }

  function renderTableLoading() {
    tableBody.innerHTML = `
      <tr class="table-status-row">
        <td colspan="18">
          <div class="inline-spinner"></div>
          Loading communication records…
        </td>
      </tr>`;
    paginationEl.innerHTML = '';
  }

  function renderTableEmpty(message) {
    tableBody.innerHTML = `
      <tr class="table-status-row">
        <td colspan="18">${escapeHtml(message)}</td>
      </tr>`;
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
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
          loadCommunications();
          document.querySelector('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function updateRecordCount() {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(totalCount, start + currentRecords.length - 1);

    if (totalCount === 0) {
      recordCountEl.textContent = '0 records';
    } else {
      recordCountEl.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} communications`;
    }
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  EDIT RECORD
   * ═════════════════════════════════════════════════════════════════════ */
  function startEdit(uuid) {
    const record = currentRecords.find(r => r.uuid === uuid);
    if (!record) return;

    isEditMode = true;
    editUuidInput.value = uuid;
    eofficeUuidInput.value = record.e_office_uuid || '';

    // Populate dropdown
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

    formTitleText.textContent = 'Edit Communication Record';
    submitBtnText.textContent = 'Update';

    // Scroll to form
    document.getElementById('form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    commNumInput.focus();
  }


  /* ═════════════════════════════════════════════════════════════════════
   *  DELETE RECORD (with Confirmation Modal)
   * ═════════════════════════════════════════════════════════════════════ */
  function confirmDelete(uuid) {
    const record = currentRecords.find(r => r.uuid === uuid);
    if (!record) return;

    deleteTargetUuid = uuid;
    modalMsg.textContent = `Are you sure you want to delete communication "${record.communication_number}"? This action cannot be undone.`;
    deleteModal.classList.add('open');
  }

  modalCancelBtn.addEventListener('click', closeDeleteModal);
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  function closeDeleteModal() {
    deleteModal.classList.remove('open');
    deleteTargetUuid = null;
    modalConfirmBtn.classList.remove('loading');
    modalConfirmBtn.disabled = false;
  }

  modalConfirmBtn.addEventListener('click', async () => {
    if (!deleteTargetUuid) return;
    modalConfirmBtn.classList.add('loading');
    modalConfirmBtn.disabled = true;

    try {
      const client = getSupabaseClient();
      const { error } = await client
        .from('communications')
        .delete()
        .eq('uuid', deleteTargetUuid);

      if (error) {
        showToast('Delete failed: ' + error.message, 'error');
      } else {
        showToast('Communication record deleted successfully.', 'success');
        await loadCommunications();
      }
    } catch (err) {
      showToast('Network error during delete: ' + err.message, 'error');
    }

    closeDeleteModal();
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
