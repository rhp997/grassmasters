// auth.js — Authentication logic for Dodson Grass Masters
// Handles login, signup, Google sign-in, logout, and role detection

let currentUser = null;
let currentUserRole = null;

// ── Toast helper ──────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const id = 'toast-' + Date.now();
  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-${type} show align-items-center" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${message}</div>
        <button type="button" class="btn-close ms-auto me-2" data-bs-dismiss="toast"></button>
      </div>
    </div>
  `);
  setTimeout(() => document.getElementById(id)?.remove(), 4000);
}

// ── Auth state listener ───────────────────────────────────────────────────────
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    // Refresh token to get latest custom claims
    const idTokenResult = await user.getIdTokenResult(true);
    currentUserRole = idTokenResult.claims.admin ? 'admin' : 'customer';

    // Ensure user profile doc exists
    await ensureUserProfile(user, currentUserRole);

    document.getElementById('public-content')?.classList.add('d-none');
    document.getElementById('app-shell')?.classList.remove('d-none');

    updateNavForAuth(user, currentUserRole);

    if (currentUserRole === 'admin') {
      showAdminDashboard();
    } else {
      showCustomerDashboard();
    }

    // Hide auth modals
    ['loginModal', 'signupModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) bootstrap.Modal.getInstance(el)?.hide();
    });
  } else {
    currentUser = null;
    currentUserRole = null;
    document.getElementById('public-content')?.classList.remove('d-none');
    document.getElementById('app-shell')?.classList.add('d-none');
    updateNavForGuest();
    teardownDashboards();
  }
});

async function ensureUserProfile(user, role) {
  const log = (msg, ...args) => console.log(`[ensureUserProfile] ${msg}`, ...args);
  log('called — uid:', user.uid, 'role:', role);

  try {
    const userRef   = db.collection('users').doc(user.uid);
    const clientRef = db.collection('clients').doc(user.uid);

    log('fetching user and client snapshots…');
    const [userSnap, clientSnap] = await Promise.all([
      userRef.get(),
      role !== 'admin' ? clientRef.get() : Promise.resolve({ exists: true })
    ]);
    log('userSnap.exists:', userSnap.exists, '| clientSnap.exists:', clientSnap.exists);

    const batch = db.batch();
    let needsCommit = false;
    let mergedFromAdmin = false;

    if (!userSnap.exists) {
      log('queuing users doc creation');
      batch.set(userRef, {
        uid:         user.uid,
        email:       user.email,
        displayName: user.displayName || '',
        phone:       '',
        role,
        zipCode:     '',
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      });
      needsCommit = true;
    }

    if (!clientSnap.exists && role !== 'admin') {
      // Check for an admin-pre-created client record matching this email
      log('no clients/{uid} doc — querying by email for admin-created record…');
      const emailSnap = await db.collection('clients')
        .where('email', '==', user.email)
        .where('uid', '==', null)
        .limit(1)
        .get();

      if (!emailSnap.empty) {
        // Found an admin-created record — migrate its data into clients/{uid}
        const adminDoc  = emailSnap.docs[0];
        const adminData = adminDoc.data();
        log('found admin-created record:', adminDoc.id, '— merging into clients/', user.uid);

        batch.set(clientRef, {
          uid:             user.uid,
          name:            adminData.name  || user.displayName || user.email.split('@')[0],
          email:           user.email,
          phone:           adminData.phone   || '',
          address:         adminData.address || '',
          notes:           adminData.notes   || '',
          createdBy:       adminData.createdBy || 'admin',
          createdAt:       adminData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
          lastServiceDate: adminData.lastServiceDate || null,
          mergedFromId:    adminDoc.id   // retains link to old appointments
        });

        // Mark old admin record as claimed so the admin list stops showing it as a duplicate
        batch.update(adminDoc.ref, {
          uid:      user.uid,
          mergedTo: user.uid
        });

        mergedFromAdmin = true;
      } else {
        log('no admin-created record found — creating fresh clients doc');
        batch.set(clientRef, {
          uid:             user.uid,
          name:            user.displayName || user.email.split('@')[0],
          email:           user.email,
          phone:           '',
          address:         '',
          notes:           '',
          createdBy:       'self-signup',
          createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
          lastServiceDate: null
        });
      }
      needsCommit = true;
    }

    if (needsCommit) {
      log('committing batch…');
      await batch.commit();
      log('batch committed successfully');
      if (mergedFromAdmin) {
        showToast('Welcome! Your profile has been pre-filled from our records.');
      }
    } else {
      log('nothing to commit — all docs already exist');
    }
  } catch (err) {
    console.error('[ensureUserProfile] ERROR:', err.code, err.message, err);
  }
}

// ── Nav updates ───────────────────────────────────────────────────────────────
function updateNavForAuth(user, role) {
  document.querySelectorAll('.nav-public-links').forEach(el => el.classList.add('d-none'));
  document.getElementById('nav-user-menu')?.classList.remove('d-none');
  const nameEl = document.getElementById('nav-user-name');
  if (nameEl) nameEl.textContent = user.displayName || user.email?.split('@')[0] || 'User';
  const roleEl = document.getElementById('nav-user-role');
  if (roleEl) roleEl.textContent = role === 'admin' ? 'Admin' : 'Customer';
}

function updateNavForGuest() {
  document.querySelectorAll('.nav-public-links').forEach(el => el.classList.remove('d-none'));
  document.getElementById('nav-user-menu')?.classList.add('d-none');
}

// ── Login form ────────────────────────────────────────────────────────────────
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in…';
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    showToast(friendlyAuthError(err.code), 'error');
    btn.disabled = false;
    btn.innerHTML = 'Sign In';
  }
});

// ── Signup form ───────────────────────────────────────────────────────────────
document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const phone    = document.getElementById('signup-phone').value.trim();
  const zip      = document.getElementById('signup-zip').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm  = document.getElementById('signup-confirm').value;

  if (!ROSWELL_ZIPS.includes(zip)) {
    showToast('Sorry — we only serve Roswell, NM (ZIP codes 88201, 88202, 88203).', 'error');
    return;
  }
  if (password !== confirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }
  if (password.length < 8) {
    showToast('Password must be at least 8 characters.', 'error');
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating account…';
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid,
      email,
      displayName: name,
      phone,
      role: 'customer',
      zipCode: zip,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Account created! Welcome to Dodson Grass Masters.');
  } catch (err) {
    showToast(friendlyAuthError(err.code), 'error');
    btn.disabled = false;
    btn.innerHTML = 'Create Account';
  }
});

// ── Google Sign-In ────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-google-signin').forEach(btn => {
  btn.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showToast(friendlyAuthError(err.code), 'error');
      }
    }
  });
});

// ── Password reset ────────────────────────────────────────────────────────────
document.getElementById('forgot-password-link')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    showToast('Enter your email address above first.', 'error');
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('Password reset email sent — check your inbox.');
  } catch (err) {
    showToast(friendlyAuthError(err.code), 'error');
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await auth.signOut();
  window.scrollTo({ top: 0 });
  showToast('Signed out successfully.');
});

// ── Error messages ────────────────────────────────────────────────────────────
function friendlyAuthError(code) {
  const map = {
    'auth/invalid-email':            'Invalid email address.',
    'auth/user-disabled':            'This account has been disabled.',
    'auth/user-not-found':           'No account found with that email.',
    'auth/wrong-password':           'Incorrect password.',
    'auth/email-already-in-use':     'An account already exists with that email.',
    'auth/weak-password':            'Password must be at least 6 characters.',
    'auth/too-many-requests':        'Too many attempts. Please try again later.',
    'auth/invalid-credential':       'Invalid email or password.',
    'auth/network-request-failed':   'Network error. Check your connection.',
  };
  return map[code] || 'Authentication error. Please try again.';
}

// ── Switch between login/signup modals ────────────────────────────────────────
document.getElementById('go-to-signup')?.addEventListener('click', (e) => {
  e.preventDefault();
  bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
  new bootstrap.Modal(document.getElementById('signupModal')).show();
});

document.getElementById('go-to-login')?.addEventListener('click', (e) => {
  e.preventDefault();
  bootstrap.Modal.getInstance(document.getElementById('signupModal'))?.hide();
  new bootstrap.Modal(document.getElementById('loginModal')).show();
});

// ── Expose to global ─────────────────────────────────────────────────────────
function getCurrentUser() { return currentUser; }
function getCurrentRole() { return currentUserRole; }
