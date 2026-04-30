/**
 * Cloud Functions for Dodson Grass Masters
 *
 * NOTE: Cloud Functions require the Firebase Blaze (pay-as-you-go) plan.
 * Upgrade at: https://console.firebase.google.com/project/grassmasters-236aa/usage/details
 *
 * Functions in this file:
 *   1. setAdminClaim      — callable: elevates a user to admin role
 *   2. bootstrapAdmin     — callable: grants first admin claim (run once)
 *   3. testSendGrid       — callable: verifies SendGrid config
 *   4. onAppointmentWrite — Firestore trigger: sends email/SMS confirmations
 *
 * Config is read from environment variables (set via Firebase Console or .env):
 *   SENDGRID_KEY, SENDGRID_FROM
 *   TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten }  = require("firebase-functions/v2/firestore");
const { logger }             = require("firebase-functions/logger");
const admin                  = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ── 0. SendGrid test ──────────────────────────────────────────────────────────
exports.testSendGrid = onCall(async (request) => {
  const key  = process.env.SENDGRID_KEY  || "";
  const from = process.env.SENDGRID_FROM || "(not set)";
  const result = { config: { keySet: !!key, from } };
  if (!key) return { ...result, error: "SENDGRID_KEY env var not set" };

  const sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(key);
  try {
    await sgMail.send({
      to:      request.data.to || from,
      from,
      subject: "Dodson Grass Masters — SendGrid test",
      text:    "SendGrid is configured and working correctly.",
    });
    return { ...result, success: true };
  } catch (e) {
    return { ...result, error: e.message, code: e.code, response: e.response?.body };
  }
});

// ── 1. Set Admin Custom Claim ─────────────────────────────────────────────────
exports.setAdminClaim = onCall(async (request) => {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Must be admin.");
  }
  const { uid } = request.data;
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  await db.collection("users").doc(uid).update({ role: "admin" });
  return { success: true, message: `Admin claim set for ${uid}` };
});

// ── 2. Bootstrap first admin (run once via CLI) ───────────────────────────────
exports.bootstrapAdmin = onCall(async (request) => {
  const { email } = request.data;
  if (!email) throw new HttpsError("invalid-argument", "email required.");
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  await db.collection("users").doc(user.uid).set({ role: "admin" }, { merge: true });
  return { success: true };
});

// ── 3. Appointment notification trigger ──────────────────────────────────────
// Fires when an appointment document is created or updated.
// Sends email via SendGrid and SMS via Twilio.
//
// Set environment variables in Firebase Console → Functions → (fn) → Edit → Environment:
//   SENDGRID_KEY=SG.xxx
//   SENDGRID_FROM=info@dodsonGrassMasters.com
//   TWILIO_SID=ACxxx
//   TWILIO_TOKEN=xxx
//   TWILIO_FROM=+15055551234
//
exports.onAppointmentWrite = onDocumentWritten("appointments/{apptId}", async (event) => {
  const after  = event.data.after.exists  ? event.data.after.data()  : null;
  const before = event.data.before.exists ? event.data.before.data() : null;

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
  const sgKey  = process.env.SENDGRID_KEY  || "";
  const sgFrom = process.env.SENDGRID_FROM || "info@dodsonGrassMasters.com";
  if (client.email && sgKey) {
    try {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sgKey);
      promises.push(sgMail.send({
        to:      client.email,
        from:    sgFrom,
        subject: `Lawn Care Appointment Confirmed — ${dateStr}`,
        text:    msg,
        html:    `<p>${msg.replace(/\n/g, "<br>")}</p>`
      }));
    } catch (e) {
      logger.warn("SendGrid error:", e.message);
    }
  }

  // Twilio SMS
  const twSid   = process.env.TWILIO_SID   || "";
  const twToken = process.env.TWILIO_TOKEN  || "";
  const twFrom  = process.env.TWILIO_FROM   || "";
  if (client.phone && twSid && twToken) {
    try {
      const twilio = require("twilio")(twSid, twToken);
      const toNum  = client.phone.replace(/\D/g, "");
      if (toNum.length >= 10) {
        promises.push(twilio.messages.create({
          body: msg,
          from: twFrom,
          to:   "+1" + toNum.slice(-10)
        }));
      }
    } catch (e) {
      logger.warn("Twilio error:", e.message);
    }
  }

  await Promise.allSettled(promises);
  return null;
});
