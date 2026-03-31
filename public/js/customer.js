// customer.js — Customer portal for Dodson Grass Masters
// Shows upcoming appointments, history, and profile management

let customerApptListener = null;
let customerUserListener = null;

// ── Show Customer Dashboard ───────────────────────────────────────────────────
function showCustomerDashboard() {
  document.getElementById('customer-dash')?.classList.remove('d-none');
  document.getElementById('admin-dash')?.classList.add('d-none');
  customerNavSetup();
  subscribeToCustomerData();
}

function customerNavSetup() {
  const allCustLinks = document.querySelectorAll('#customer-sidebar .sidebar-nav .nav-link, #customer-mobile-nav .nav-link');
  allCustLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.view;
      document.querySelectorAll('#customer-dash .dash-view').forEach(v => v.classList.remove('active'));
      document.getElementById('cust-view-' + target)?.classList.add('active');
      allCustLinks.forEach(l => l.classList.remove('active'));
      document.querySelectorAll('[data-view="' + target + '"]').forEach(l => l.classList.add('active'));
    });
  });
}

function subscribeToCustomerData() {
  const uid = getCurrentUser()?.uid;
  if (!uid) return;

  // Subscribe to customer's appointments via clientUid field
  customerApptListener?.();
  customerApptListener = db.collection('appointments')
    .where('clientUid', '==', uid)
    .orderBy('dateTime', 'asc')
    .onSnapshot(snap => {
      const appts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCustomerAppointments(appts);
    }, err => {
      // Fallback: no appointments linked yet
      renderCustomerAppointments([]);
    });

  // Load profile
  customerUserListener?.();
  customerUserListener = db.collection('users').doc(uid).onSnapshot(snap => {
    if (snap.exists) populateCustomerProfile(snap.data());
  });
}

function renderCustomerAppointments(appts) {
  const now = new Date().toISOString();
  const upcoming = appts.filter(a => a.status === 'scheduled' && a.dateTime >= now);
  const past     = appts.filter(a => a.status === 'completed' || a.dateTime < now);

  // Stats
  const nextAppt = upcoming[0];
  setText('cust-stat-next',    nextAppt ? formatDateMT(nextAppt.dateTime) : 'None scheduled');
  setText('cust-stat-total',   appts.length);
  setText('cust-stat-pending', appts.filter(a => a.paymentStatus === 'pending' && a.status !== 'cancelled').length);

  // Upcoming list
  const upcomingHtml = upcoming.length
    ? upcoming.map(a => customerApptCard(a)).join('')
    : '<p class="text-muted text-center py-4">No upcoming appointments. Contact us to schedule service!</p>';
  setHtml('cust-upcoming-list', upcomingHtml);

  // History list
  const historyHtml = past.length
    ? past.sort((a, b) => b.dateTime.localeCompare(a.dateTime)).map(a => customerApptCard(a, true)).join('')
    : '<p class="text-muted text-center py-4">No past appointments yet.</p>';
  setHtml('cust-history-list', historyHtml);
}

function customerApptCard(a, isPast = false) {
  const svcLabel = SERVICE_TYPES.find(s => s.value === a.serviceType)?.label || a.serviceType || 'Service';
  const svcIcon  = SERVICE_TYPES.find(s => s.value === a.serviceType)?.icon || 'bi-tools';
  return `
    <div class="card mb-3 border-0 shadow-sm">
      <div class="card-body">
        <div class="d-flex align-items-start gap-3">
          <div class="stat-icon green flex-shrink-0">
            <i class="bi ${escHtml(svcIcon)}"></i>
          </div>
          <div class="flex-grow-1">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
              <div>
                <h6 class="mb-1">${escHtml(svcLabel)}</h6>
                <p class="mb-1 text-muted small"><i class="bi bi-calendar3 me-1"></i>${formatMT(a.dateTime)}</p>
                ${a.durationMinutes ? `<p class="mb-1 text-muted small"><i class="bi bi-clock me-1"></i>Est. ${a.durationMinutes} min</p>` : ''}
                ${a.notes ? `<p class="mb-0 small fst-italic text-muted">${escHtml(a.notes)}</p>` : ''}
              </div>
              <div class="text-end">
                <span class="badge-status badge-${a.status}">${a.status}</span>
                <br><span class="badge-status badge-${a.paymentStatus || 'pending'} mt-1">${a.paymentStatus || 'pending'}</span>
                ${a.paymentAmount ? `<br><small class="text-muted">${formatCurrency(a.paymentAmount)}</small>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function populateCustomerProfile(data) {
  setValue('profile-name',  data.displayName || '');
  setValue('profile-email', data.email || '');
  setValue('profile-phone', data.phone || '');
  setValue('profile-zip',   data.zipCode || '');
}

// ── Profile Save ──────────────────────────────────────────────────────────────
document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = getCurrentUser()?.uid;
  if (!uid) return;

  const phone = document.getElementById('profile-phone').value.trim();
  const zip   = document.getElementById('profile-zip').value.trim();

  if (zip && !ROSWELL_ZIPS.includes(zip)) {
    showToast('Sorry — we only serve Roswell, NM ZIP codes (88201, 88202, 88203).', 'error');
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await db.collection('users').doc(uid).update({
      phone,
      zipCode:   zip,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Update display name in Auth
    const name = document.getElementById('profile-name').value.trim();
    if (name && name !== getCurrentUser()?.displayName) {
      await getCurrentUser().updateProfile({ displayName: name });
    }
    showToast('Profile updated successfully.');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────
function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
