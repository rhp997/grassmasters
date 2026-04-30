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

// ── 0. SendGrid test (invoke via: firebase functions:shell → testSendGrid({to:'you@example.com'})) ──
exports.testSendGrid = functions.https.onCall(async (data) => {
  const sgConfig = functions.config().sendgrid || {};
  const result = { config: { keySet: !!sgConfig.key, from: sgConfig.from || "(not set)" } };
  if (!sgConfig.key) return { ...result, error: "sendgrid.key not configured" };

  const sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(sgConfig.key);
  try {
    await sgMail.send({
      to:      data.to || sgConfig.from,
      from:    sgConfig.from,
      subject: "Dodson Grass Masters — SendGrid test",
      text:    "SendGrid is configured and working correctly.",
    });
    return { ...result, success: true };
  } catch (e) {
    return { ...result, error: e.message, code: e.code, response: e.response?.body };
  }
});

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

    // dateTime is stored as "YYYY-MM-DDTHH:mm" in Mountain Time (no TZ offset).
    // Node.js (UTC) would misparse it as UTC, so we supply the correct MT offset.
    // MDT (UTC−6) runs roughly March–November; MST (UTC−7) the rest of the year.
    const dateStr = after.dateTime
      ? (() => {
          const dt = after.dateTime;
          const month = parseInt(dt.substring(5, 7), 10);
          const offset = (month >= 3 && month <= 11) ? "-06:00" : "-07:00";
          return new Date(dt + ":00" + offset).toLocaleString("en-US", {
            timeZone: "America/Denver",
            weekday: "long", month: "long", day: "numeric",
            year: "numeric", hour: "numeric", minute: "2-digit"
          });
        })()
      : "TBD";

    const msg = `Your Dodson Grass Masters appointment is confirmed for ${dateStr} at ${client.address || "your property"}, Roswell, NM. Questions? Call/text (575) 626-8482.`;

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
