// Firebase configuration for Dodson Grass Masters
// Project: grassmasters-236aa

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyB7HGxz_RrckU7liCA-iseuA4cc6Ztax1w",
  authDomain:        "grassmasters-236aa.firebaseapp.com",
  projectId:         "grassmasters-236aa",
  storageBucket:     "grassmasters-236aa.firebasestorage.app",
  messagingSenderId: "676435370651",
  appId:             "1:676435370651:web:063e6b4a22773be58b9c3e",
  measurementId:     "G-H7QP5XS98M"
};

// Detect local emulator environment
const IS_EMULATOR = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);

// Initialize Firebase app (compat SDK loaded via CDN in index.html)
firebase.initializeApp(FIREBASE_CONFIG);

const db   = firebase.firestore();
const auth = firebase.auth();

// Connect to emulators when running locally
if (IS_EMULATOR) {
  console.log('[GrassMasters] Using Firebase Emulators');
  auth.useEmulator('http://127.0.0.1:9099');
  db.useEmulator('127.0.0.1', 8080);
}

// Roswell, NM valid ZIP codes
const ROSWELL_ZIPS = ['88201', '88202', '88203'];

// Service types
const SERVICE_TYPES = [
  { value: 'mow',       label: 'Lawn Mowing',        icon: 'bi-scissors' },
  { value: 'edge',      label: 'Edging',              icon: 'bi-reception-4' },
  { value: 'blow',      label: 'Blowing / Cleanup',   icon: 'bi-wind' },
  { value: 'weed',      label: 'Weeding',             icon: 'bi-flower1' },
  { value: 'fertilize', label: 'Fertilizing',         icon: 'bi-droplet' },
  { value: 'plant',     label: 'Planting',            icon: 'bi-tree' },
  { value: 'full',      label: 'Full Service',        icon: 'bi-star' },
  { value: 'other',     label: 'Other / Hourly',      icon: 'bi-tools' }
];

// Mountain Time zone (America/Denver)
const TIMEZONE = 'America/Denver';

function formatMT(dateISO) {
  if (!dateISO) return '—';
  return new Date(dateISO).toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function formatDateMT(dateISO) {
  if (!dateISO) return '—';
  return new Date(dateISO).toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatCurrency(val) {
  if (val == null) return '—';
  return '$' + Number(val).toFixed(2);
}
