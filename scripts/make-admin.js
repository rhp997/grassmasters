#!/usr/bin/env node
// Usage: node scripts/make-admin.js <email>
// Run while Firebase emulators are running (auth:9099, firestore:8080)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const admin = require(require('path').join(__dirname, '../functions/node_modules/firebase-admin'));

admin.initializeApp({ projectId: 'grassmasters-236aa' });

async function makeAdmin(email) {
  if (!email) {
    console.error('Usage: node scripts/make-admin.js <email>');
    process.exit(1);
  }
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  await admin.firestore().collection('users').doc(user.uid).set(
    { role: 'admin' },
    { merge: true }
  );
  console.log(`✓ Admin claim set for ${email} (uid: ${user.uid})`);
  process.exit(0);
}

makeAdmin(process.argv[2]).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
