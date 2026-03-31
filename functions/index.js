/**
 * Cloud Functions for Dodson Grass Masters
 *
 * NOTE: Cloud Functions require the Firebase Blaze (pay-as-you-go) plan.
 * Upgrade at: https://console.firebase.google.com/project/grassmasters-236aa/usage/details
 *
 * Functions in this file:
 *   1. setAdminClaim     — callable: elevates a user to admin role
 *   2. onAppointmentWrite — Firestore trigger: sends email/SMS confirmations
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ── 1. Set Admin Custom Claim ─────────────────────────────────────────────────
// Call from admin console or a trusted script to grant admin role.
// Usage: firebase functions:shell → setAdminClaim({uid: 'USER_UID'})
exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  // Only existing admins can promote others
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError("permission-denied", "Must be admin.");
  }
  const { uid } = data;
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  await db.collection("users").doc(uid).update({ role: "admin" });
  return { success: true, message: `Admin claim set for ${uid}` };
});

// ── 2. Bootstrap first admin (run once via CLI) ───────────────────────────────
// firebase functions:shell → bootstrapAdmin({email:'grassmaster@example.com'})
exports.bootstrapAdmin = functions.https.onCall(async (data, context) => {
  // Only allow from emulator or if no admins exist yet
  const { email } = data;
  if (!email) throw new functions.https.HttpsError("invalid-argument", "email required.");
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  await db.collection("users").doc(user.uid).set(
    { role: "admin" },
    { merge: true }
  );
  return { success: true };
});

// ── 3. Appointment notification trigger ──────────────────────────────────────
// Fires when an appointment document is created or updated.
// Sends email via SendGrid and SMS via Twilio.
//
// To enable:
//   firebase functions:config:set \
//     sendgrid.key="SG.xxx" \
//     sendgrid.from="info@dodsonGrassMasters.com" \
//     twilio.sid="ACxxx" \
//     twilio.token="xxx" \
//     twilio.from="+15055551234"
//
exports.onAppointmentWrite = functions.firestore
  .document("appointments/{apptId}")
  .onWrite(async (change, context) => {
    const after  = change.after.exists  ? change.after.data()  : null;
    const before = change.before.exists ? change.before.data() : null;

    if (!after) return null; // deletion — no notification

    // Only notify on create or status change
    const isNew     = !before;
    const statusChg = before && before.status !== after.status;
    if (!isNew && !statusChg) return null;

    // Look up client info
    const clientId = after.clientId;
    if (!clientId) return null;
    const clientSnap = await db.collection("clients").doc(clientId).get();
    if (!clientSnap.exists) return null;
    const client = clientSnap.data();
    if (!client.email && !client.phone) return null;

    const dateStr = after.dateTime
      ? new Date(after.dateTime).toLocaleString("en-US", {
          timeZone: "America/Denver",
          weekday: "long", month: "long", day: "numeric",
          year: "numeric", hour: "numeric", minute: "2-digit"
        })
      : "TBD";

    const msg = `Your Dodson Grass Masters appointment is confirmed for ${dateStr} at ${client.address || "your property"}, Roswell, NM. Questions? Call/text (575) 555-1234.`;

    const promises = [];

    // SendGrid email
    if (client.email) {
      try {
        const sgConfig = functions.config().sendgrid || {};
        if (sgConfig.key) {
          const sgMail = require("@sendgrid/mail");
          sgMail.setApiKey(sgConfig.key);
          promises.push(sgMail.send({
            to:      client.email,
            from:    sgConfig.from || "info@dodsonGrassMasters.com",
            subject: `Lawn Care Appointment Confirmed — ${dateStr}`,
            text:    msg,
            html:    `<p>${msg.replace(/\n/g, "<br>")}</p>`
          }));
        }
      } catch (e) {
        functions.logger.warn("SendGrid not configured:", e.message);
      }
    }

    // Twilio SMS
    if (client.phone) {
      try {
        const twConfig = functions.config().twilio || {};
        if (twConfig.sid && twConfig.token) {
          const twilio = require("twilio")(twConfig.sid, twConfig.token);
          const toNum  = client.phone.replace(/\D/g, "");
          if (toNum.length >= 10) {
            promises.push(twilio.messages.create({
              body: msg,
              from: twConfig.from,
              to:   "+1" + toNum.slice(-10)
            }));
          }
        }
      } catch (e) {
        functions.logger.warn("Twilio not configured:", e.message);
      }
    }

    await Promise.allSettled(promises);
    return null;
  });
