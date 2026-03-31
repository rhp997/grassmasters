// admin.js — Admin dashboard for Dodson Grass Masters
// Manages calendar, clients, appointments, and payment tracking

let adminCalendar = null;
let appointmentsListener = null;
let clientsListener = null;
let allAppointments = [];
let allClients = [];

// ── Show Admin Dashboard ──────────────────────────────────────────────────────
function showAdminDashboard() {
  document.getElementById('admin-dash')?.classList.remove('d-none');
  document.getElementById('customer-dash')?.classList.add('d-none');
  adminNavSetup();
  loadAdminStats();
  initAdminCalendar();
  subscribeToAppointments();
  subscribeToClients();
}

function teardownDashboards() {
  adminCalendar?.destroy();
  adminCalendar = null;
  appointmentsListener?.();
  appointmentsListener = null;
  clientsListener?.();
  clientsListener = null;
  allAppointments = [];
  allClients = [];
  document.getElementById('admin-dash')?.classList.add('d-none');
  document.getElementById('customer-dash')?.classList.add('d-none');
}

// ── Admin Sidebar Navigation ──────────────────────────────────────────────────
function adminNavSetup() {
  document.querySelectorAll('#admin-sidebar .sidebar-nav .nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.view;
      document.querySelectorAll('#admin-dash .dash-view').forEach(v => v.classList.remove('active'));
      document.getElementById('admin-view-' + target)?.classList.add('active');
      document.querySelectorAll('#admin-sidebar .nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      if (target === 'calendar') adminCalendar?.updateSize();
      if (target === 'clients') renderClientsTable();
      if (target === 'appointments') renderAppointmentsTable();
      if (target === 'payments') renderPaymentsTable();
    });
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadAdminStats() {
  // Stats are derived from live subscription data; initial load shows skeletons
  updateStatCards();
}

function updateStatCards() {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const upcoming   = allAppointments.filter(a => a.status === 'scheduled' && a.dateTime >= todayStr);
  const unpaid     = allAppointments.filter(a => a.paymentStatus === 'pending' && a.status !== 'cancelled');
  const paidAmt    = allAppointments.filter(a => a.paymentStatus === 'paid')
                                    .reduce((s, a) => s + (a.paymentAmount || 0), 0);
  const todayJobs  = allAppointments.filter(a => a.dateTime?.slice(0, 10) === todayStr);

  setText('stat-upcoming',  upcoming.length);
  setText('stat-clients',   allClients.length);
  setText('stat-unpaid',    unpaid.length);
  setText('stat-revenue',   formatCurrency(paidAmt));
  setText('stat-today',     todayJobs.length);
}

// ── Firestore Subscriptions ───────────────────────────────────────────────────
function subscribeToAppointments() {
  appointmentsListener?.();
  appointmentsListener = db.collection('appointments')
    .orderBy('dateTime', 'asc')
    .onSnapshot(snap => {
      allAppointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateStatCards();
      refreshCalendarEvents();
      // Re-render active table views
      const activeView = document.querySelector('#admin-dash .dash-view.active');
      if (activeView?.id === 'admin-view-appointments') renderAppointmentsTable();
      if (activeView?.id === 'admin-view-payments') renderPaymentsTable();
    }, err => console.error('appointments listener:', err));
}

function subscribeToClients() {
  clientsListener?.();
  clientsListener = db.collection('clients')
    .orderBy('name', 'asc')
    .onSnapshot(snap => {
      allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateStatCards();
      const activeView = document.querySelector('#admin-dash .dash-view.active');
      if (activeView?.id === 'admin-view-clients') renderClientsTable();
    }, err => console.error('clients listener:', err));
}

// ── FullCalendar ──────────────────────────────────────────────────────────────
function initAdminCalendar() {
  const el = document.getElementById('admin-calendar');
  if (!el || adminCalendar) return;

  adminCalendar = new FullCalendar.Calendar(el, {
    initialView:       'dayGridMonth',
    headerToolbar: {
      left:   'prev,next today',
      center: 'title',
      right:  'dayGridMonth,timeGridWeek,timeGridDay'
    },
    timeZone:     TIMEZONE,
    height:       'auto',
    editable:     true,
    selectable:   true,
    eventClick:   ({ event }) => openAppointmentOffcanvas(event.id),
    select:       (info)     => openNewAppointmentOffcanvas(info.startStr),
    eventDrop:    ({ event, revert }) => rescheduleAppointment(event.id, event.startStr, revert),
    eventClassNames: ({ event }) => ['fc-event-' + (event.extendedProps.status || 'scheduled')],
    events: []
  });
  adminCalendar.render();
}

function refreshCalendarEvents() {
  if (!adminCalendar) return;
  adminCalendar.removeAllEvents();
  allAppointments.forEach(a => {
    const client = allClients.find(c => c.id === a.clientId);
    adminCalendar.addEvent({
      id:    a.id,
      title: (client?.name || 'Client') + ' · ' + (SERVICE_TYPES.find(s => s.value === a.serviceType)?.label || a.serviceType),
      start: a.dateTime,
      extendedProps: { status: a.status, paymentStatus: a.paymentStatus }
    });
  });
}

async function rescheduleAppointment(id, newDateTime, revert) {
  try {
    await db.collection('appointments').doc(id).update({
      dateTime:  newDateTime,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Appointment rescheduled.');
  } catch (e) {
    showToast('Failed to reschedule: ' + e.message, 'error');
    revert();
  }
}

// ── Appointments Table ────────────────────────────────────────────────────────
function renderAppointmentsTable(filterStatus = '') {
  const tbody = document.getElementById('appointments-tbody');
  if (!tbody) return;

  let list = [...allAppointments];
  if (filterStatus) list = list.filter(a => a.status === filterStatus);
  list.sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));

  const html = list.map(a => {
    const client = allClients.find(c => c.id === a.clientId);
    return `
      <tr>
        <td>${formatMT(a.dateTime)}</td>
        <td><strong>${escHtml(client?.name || '—')}</strong><br><small class="text-muted">${escHtml(client?.address || '')}</small></td>
        <td>${escHtml(SERVICE_TYPES.find(s => s.value === a.serviceType)?.label || a.serviceType || '—')}</td>
        <td><span class="badge-status badge-${a.status || 'scheduled'}">${a.status || 'scheduled'}</span></td>
        <td><span class="badge-status badge-${a.paymentStatus || 'pending'}">${a.paymentStatus || 'pending'}</span>${a.paymentAmount ? '<br><small>' + formatCurrency(a.paymentAmount) + '</small>' : ''}</td>
        <td>
          <button class="btn btn-sm btn-outline-secondary me-1" onclick="openAppointmentOffcanvas('${a.id}')">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteAppointment('${a.id}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">No appointments found.</td></tr>';

  tbody.innerHTML = html;
  document.getElementById('appointments-count').textContent = list.length + ' appointment' + (list.length !== 1 ? 's' : '');
}

// ── Clients Table ─────────────────────────────────────────────────────────────
function renderClientsTable(search = '') {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;

  let list = [...allClients];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    );
  }

  const html = list.map(c => {
    const lastSvc = allAppointments
      .filter(a => a.clientId === c.id && a.status === 'completed')
      .sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''))[0];
    return `
      <tr>
        <td><strong>${escHtml(c.name)}</strong></td>
        <td>${escHtml(c.address || '—')}</td>
        <td><a href="tel:${escHtml(c.phone)}">${escHtml(c.phone || '—')}</a></td>
        <td><a href="mailto:${escHtml(c.email)}">${escHtml(c.email || '—')}</a></td>
        <td>${lastSvc ? formatDateMT(lastSvc.dateTime) : '—'}</td>
        <td>
          <button class="btn btn-sm btn-outline-secondary me-1" onclick="openClientModal('${c.id}')">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-primary me-1" onclick="openNewAppointmentOffcanvas('', '${c.id}')" title="New Appointment">
            <i class="bi bi-calendar-plus"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteClient('${c.id}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">No clients found.</td></tr>';

  tbody.innerHTML = html;
  document.getElementById('clients-count').textContent = list.length + ' client' + (list.length !== 1 ? 's' : '');
}

// ── Payments Table ────────────────────────────────────────────────────────────
function renderPaymentsTable(filter = 'all') {
  const tbody = document.getElementById('payments-tbody');
  if (!tbody) return;

  let list = allAppointments.filter(a => a.status !== 'cancelled');
  if (filter === 'pending') list = list.filter(a => a.paymentStatus === 'pending');
  if (filter === 'paid')    list = list.filter(a => a.paymentStatus === 'paid');
  list.sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));

  const totalPaid    = list.filter(a => a.paymentStatus === 'paid').reduce((s, a) => s + (a.paymentAmount || 0), 0);
  const totalUnpaid  = list.filter(a => a.paymentStatus === 'pending').length;

  setText('pay-total-paid', formatCurrency(totalPaid));
  setText('pay-count-unpaid', totalUnpaid);

  const html = list.map(a => {
    const client = allClients.find(c => c.id === a.clientId);
    const isPaid = a.paymentStatus === 'paid';
    return `
      <tr class="${isPaid ? '' : 'table-warning-soft'}">
        <td>${formatDateMT(a.dateTime)}</td>
        <td>${escHtml(client?.name || '—')}</td>
        <td>${escHtml(SERVICE_TYPES.find(s => s.value === a.serviceType)?.label || a.serviceType || '—')}</td>
        <td><span class="badge-status badge-${a.paymentStatus || 'pending'}">${a.paymentStatus || 'pending'}</span></td>
        <td>${a.paymentAmount ? formatCurrency(a.paymentAmount) : '—'}</td>
        <td>${a.paymentDate ? formatDateMT(a.paymentDate) : '—'}</td>
        <td>${a.paidBy || '—'}</td>
        <td>
          ${!isPaid
            ? `<button class="btn btn-sm btn-gm" onclick="openMarkPaidModal('${a.id}')">Mark Paid</button>`
            : `<button class="btn btn-sm btn-outline-secondary" onclick="undoPayment('${a.id}')">Undo</button>`
          }
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-center text-muted py-4">No records found.</td></tr>';

  tbody.innerHTML = html;
}

// ── Mark Paid ─────────────────────────────────────────────────────────────────
function openMarkPaidModal(apptId) {
  document.getElementById('pay-appt-id').value = apptId;
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('pay-method').value = 'cash';
  new bootstrap.Modal(document.getElementById('markPaidModal')).show();
}

document.getElementById('mark-paid-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id     = document.getElementById('pay-appt-id').value;
  const amount = parseFloat(document.getElementById('pay-amount').value) || 0;
  const date   = document.getElementById('pay-date').value;
  const method = document.getElementById('pay-method').value;
  try {
    await db.collection('appointments').doc(id).update({
      paymentStatus: 'paid',
      paymentAmount: amount,
      paymentDate:   date,
      paidBy:        method,
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    });
    bootstrap.Modal.getInstance(document.getElementById('markPaidModal'))?.hide();
    showToast('Payment recorded successfully.');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
});

async function undoPayment(id) {
  if (!confirm('Remove payment record for this appointment?')) return;
  try {
    await db.collection('appointments').doc(id).update({
      paymentStatus: 'pending',
      paymentAmount: firebase.firestore.FieldValue.delete(),
      paymentDate:   firebase.firestore.FieldValue.delete(),
      paidBy:        firebase.firestore.FieldValue.delete(),
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Payment record removed.');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportPaymentsCSV() {
  const rows = [['Date', 'Client', 'Service', 'Status', 'Amount', 'Paid Date', 'Method']];
  allAppointments.filter(a => a.status !== 'cancelled').forEach(a => {
    const client = allClients.find(c => c.id === a.clientId);
    rows.push([
      formatDateMT(a.dateTime),
      client?.name || '',
      SERVICE_TYPES.find(s => s.value === a.serviceType)?.label || a.serviceType || '',
      a.paymentStatus || '',
      a.paymentAmount != null ? a.paymentAmount : '',
      a.paymentDate || '',
      a.paidBy || ''
    ]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'grassmasters-payments-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Appointment Offcanvas (Create/Edit) ───────────────────────────────────────
let editingApptId = null;

function openNewAppointmentOffcanvas(dateStr = '', clientId = '') {
  editingApptId = null;
  document.getElementById('appt-form')?.reset();
  document.getElementById('appt-offcanvas-title').textContent = 'New Appointment';
  document.getElementById('delete-appt-btn').classList.add('d-none');
  if (dateStr) {
    document.getElementById('appt-datetime').value = dateStr.slice(0, 16);
  }
  if (clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (client) populateClientInForm(client);
  }
  new bootstrap.Offcanvas(document.getElementById('apptOffcanvas')).show();
}

function openAppointmentOffcanvas(id) {
  const appt = allAppointments.find(a => a.id === id);
  if (!appt) return;
  editingApptId = id;
  document.getElementById('appt-offcanvas-title').textContent = 'Edit Appointment';
  document.getElementById('delete-appt-btn').classList.remove('d-none');

  const client = allClients.find(c => c.id === appt.clientId);
  if (client) populateClientInForm(client);

  setValue('appt-datetime',       (appt.dateTime || '').slice(0, 16));
  setValue('appt-service',        appt.serviceType || '');
  setValue('appt-duration',       appt.durationMinutes || '60');
  setValue('appt-status',         appt.status || 'scheduled');
  setValue('appt-recurring',      appt.recurring || 'none');
  setValue('appt-notes',          appt.notes || '');

  new bootstrap.Offcanvas(document.getElementById('apptOffcanvas')).show();
}

function populateClientInForm(client) {
  setValue('appt-client-id',    client.id);
  setValue('appt-client-name',  client.name);
  setValue('appt-client-addr',  client.address || '');
  setValue('appt-client-phone', client.phone || '');
}

// Client search within appointment form
let clientSearchTimeout = null;
document.getElementById('appt-client-name')?.addEventListener('input', function() {
  clearTimeout(clientSearchTimeout);
  const q = this.value.trim().toLowerCase();
  const dropdown = document.getElementById('client-search-dropdown');
  if (!q || q.length < 2) { dropdown.innerHTML = ''; dropdown.classList.add('d-none'); return; }
  clientSearchTimeout = setTimeout(() => {
    const matches = allClients.filter(c =>
      c.name.toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q)
    ).slice(0, 6);
    if (!matches.length) { dropdown.innerHTML = ''; dropdown.classList.add('d-none'); return; }
    dropdown.innerHTML = matches.map(c => `
      <div class="client-search-result" onclick="selectClientForAppt('${c.id}')">
        <strong>${escHtml(c.name)}</strong><br>
        <small>${escHtml(c.address || '')} · ${escHtml(c.phone || '')}</small>
      </div>`).join('');
    dropdown.classList.remove('d-none');
  }, 200);
});

function selectClientForAppt(clientId) {
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;
  populateClientInForm(client);
  document.getElementById('client-search-dropdown').classList.add('d-none');
}

document.getElementById('appt-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientId   = document.getElementById('appt-client-id').value;
  const clientName = document.getElementById('appt-client-name').value.trim();
  const dateTime   = document.getElementById('appt-datetime').value;
  const serviceType= document.getElementById('appt-service').value;
  const duration   = parseInt(document.getElementById('appt-duration').value) || 60;
  const status     = document.getElementById('appt-status').value;
  const recurring  = document.getElementById('appt-recurring').value;
  const notes      = document.getElementById('appt-notes').value.trim();

  if (!dateTime || !serviceType || !clientName) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    let resolvedClientId = clientId;

    // If no client ID but name given, create a quick client record
    if (!resolvedClientId && clientName) {
      const clientRef = await db.collection('clients').add({
        name:    clientName,
        address: document.getElementById('appt-client-addr').value.trim(),
        phone:   document.getElementById('appt-client-phone').value.trim(),
        email:   '',
        notes:   '',
        createdBy: getCurrentUser()?.uid || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      resolvedClientId = clientRef.id;
    }

    const data = {
      clientId:        resolvedClientId,
      dateTime,
      serviceType,
      durationMinutes: duration,
      status,
      recurring,
      notes,
      paymentStatus:   editingApptId
        ? (allAppointments.find(a => a.id === editingApptId)?.paymentStatus || 'pending')
        : 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (editingApptId) {
      await db.collection('appointments').doc(editingApptId).update(data);
      showToast('Appointment updated.');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = getCurrentUser()?.uid || '';
      await db.collection('appointments').add(data);

      // Handle recurring appointments (weekly / bi-weekly)
      if (recurring !== 'none') {
        const weeks = recurring === 'weekly' ? [1, 2, 3, 4, 5, 6, 7, 8] : [2, 4, 6, 8, 10, 12];
        const baseDate = new Date(dateTime);
        for (const w of weeks) {
          const d = new Date(baseDate);
          d.setDate(d.getDate() + w * 7);
          await db.collection('appointments').add({
            ...data,
            dateTime:  d.toISOString().slice(0, 16),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }
      showToast('Appointment created.');
    }

    bootstrap.Offcanvas.getInstance(document.getElementById('apptOffcanvas'))?.hide();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function deleteAppointment(id) {
  if (!confirm('Delete this appointment? This cannot be undone.')) return;
  try {
    await db.collection('appointments').doc(id).delete();
    bootstrap.Offcanvas.getInstance(document.getElementById('apptOffcanvas'))?.hide();
    showToast('Appointment deleted.');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

document.getElementById('delete-appt-btn')?.addEventListener('click', () => {
  if (editingApptId) deleteAppointment(editingApptId);
});

// ── Client Modal (Create/Edit) ────────────────────────────────────────────────
let editingClientId = null;

function openClientModal(id = null) {
  editingClientId = id;
  document.getElementById('client-form')?.reset();
  const modal = new bootstrap.Modal(document.getElementById('clientModal'));
  if (id) {
    const client = allClients.find(c => c.id === id);
    if (!client) return;
    document.getElementById('client-modal-title').textContent = 'Edit Client';
    setValue('client-name',    client.name);
    setValue('client-address', client.address || '');
    setValue('client-phone',   client.phone || '');
    setValue('client-email',   client.email || '');
    setValue('client-notes',   client.notes || '');
  } else {
    document.getElementById('client-modal-title').textContent = 'New Client';
  }
  modal.show();
}

document.getElementById('client-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name:    document.getElementById('client-name').value.trim(),
    address: document.getElementById('client-address').value.trim(),
    phone:   document.getElementById('client-phone').value.trim(),
    email:   document.getElementById('client-email').value.trim(),
    notes:   document.getElementById('client-notes').value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (!data.name) { showToast('Client name is required.', 'error'); return; }
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    if (editingClientId) {
      await db.collection('clients').doc(editingClientId).update(data);
      showToast('Client updated.');
    } else {
      data.createdBy = getCurrentUser()?.uid || '';
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('clients').add(data);
      showToast('Client added.');
    }
    bootstrap.Modal.getInstance(document.getElementById('clientModal'))?.hide();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function deleteClient(id) {
  const apptCount = allAppointments.filter(a => a.clientId === id).length;
  const msg = apptCount
    ? `This client has ${apptCount} appointment(s). Delete client anyway? Appointments will remain but be unlinked.`
    : 'Delete this client?';
  if (!confirm(msg)) return;
  try {
    await db.collection('clients').doc(id).delete();
    showToast('Client deleted.');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ── Search / Filter Handlers ──────────────────────────────────────────────────
document.getElementById('client-search-input')?.addEventListener('input', function() {
  renderClientsTable(this.value);
});

document.getElementById('appt-status-filter')?.addEventListener('change', function() {
  renderAppointmentsTable(this.value);
});

document.getElementById('payment-filter')?.addEventListener('change', function() {
  renderPaymentsTable(this.value);
});

// ── Utility ───────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
