#!/usr/bin/env node
// Sets admin custom claim on a production Firebase user.
// Usage: node scripts/make-admin-prod.js <email> <path-to-service-account.json>
// Example: node scripts/make-admin-prod.js jrydodson@gmail.com ~/service-account.json

const path       = require('path');
const admin      = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));

const [,, email, keyFile] = process.argv;

if (!email || !keyFile) {
  console.error('Usage: node scripts/make-admin-prod.js <email> <path-to-service-account.json>');
  process.exit(1);
}

const serviceAccount = require(path.resolve(keyFile));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId:  'grassmasters-236aa'
});

async function run() {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  await admin.firestore().collection('users').doc(user.uid).set(
    { role: 'admin' },
    { merge: true }
  );
  console.log(`✓ Admin claim set for ${email} (uid: ${user.uid})`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
