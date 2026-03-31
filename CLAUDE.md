# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Background:** A young entrepreneur wishes to offer mowing, edging, blowing, weeding, fertilzing, and planting services to the Roswell, NM community (only). Create a website that serves as a lawn mowing rate brochure and scheduling application.

**Target Audience:** Single small lawn-care operator in Roswell, NM (fewer than 100 active clients)

**Goal:** Provide Jobber-like (https://www.getjobber.com/industries/lawn-care-software/) core functionality (scheduling, client management, calendar, job tracking, payment records, and customer self-service) in a simple, low-maintenance Firebase web app that stays comfortably inside the Firebase Spark (free) tier. The app is strictly for the Roswell, NM service area only.

- Business is named Dodson Grass Masters
- Firebase project ID: `grassmasters-236aa`
- Firebase web app ID: `1:676435370651:web:063e6b4a22773be58b9c3e`

**Details:** The website shall be a single page site with Introduction (landing), Rates, Schedule, Contact, and Admin sections. Generate a list of rates for each service provided and also list an hourly rate for non-listed services.

## Business & Scope Constraints

- **Geographic restriction:** All users and jobs must be in Roswell, NM (ZIP codes 88201, 88202, 88203). The app will validate ZIP code on signup and display a clear “Roswell, NM only” banner.
- **Usage scale:** <100 clients, <10 jobs per day → well under Firebase free-tier quotas (Firestore: 1 GiB storage / 50 k reads / 20 k writes per day; Realtime Database: 1 GiB / 100 simultaneous connections; Hosting: 10 GB storage / 360 MB/day transfer).
- **No online payments:** Workers collect cash/check on-site. The system only tracks payment status and amounts.
- **No full quoting engine or route optimization:** Keep simple (one-off or recurring lawn-care appointments only).
- **No crew mobile app:** Single web interface works on desktop and mobile browsers.

## Structure

```
public/           # Firebase Hosting root
  css/global.css  # All styles — Grass/green themed
  index.html      # Single-page site (Rates, Schedule, Contact)
  404.html        # Error page
  site.webmanifest
  images/         # Website images
firebase.json
.firebaserc
```

## Design & Tech Stack

All colors are defined as CSS variables in `public/css/global.css`:

Stack: Bootstrap 5.3.3 + Bootstrap Icons 1.11.3 + Google Fonts (Montserrat headings, Open Sans body) + Firebase + Cloud Firestore (free tier) and Cloud Functions + Cloud Functions + SendGrid (free tier) and Twilio for SMS.

The website should be themed to complement the logo found at /docs/logo.pdf and will be hosted on Firebase.

## User Roles & Authentication

- Two roles only (enforced via Firebase Custom Claims):
  - **Admin** (business owner/staff) – full CRUD on all data.
  - **Customer** – read-only access to own profile, appointments, and payment history; can update contact info.

- Login flow (same for both roles):
  1. Email + password (or Google) sign-in page (Bootstrap-styled).
  2. Create one admin account: grassmaster. All other accounts assume the customer role.
  3. After login, redirect to role-specific dashboard.
  4. Firebase Security Rules will enforce:
  5. Customers can only read/write documents where ownerUid === request.auth.uid.
  6. Admins (custom claim admin: true) have full read/write access.

- Password reset and email verification handled by Firebase Auth out of the box.

## Core Data Model (Firestore Collections – Simple & Flat)

- **users** (Firebase Auth + Firestore mirror for profile data)
  - Fields: uid, email, phone, displayName, role (admin/customer), zipCode (validated 8820x)

- **clients** (contacts – managed by Admin; auto-created on customer first sign-in)
  - Fields: clientId, uid (Firebase Auth UID), name, address, phone, email, notes, createdBy, lastServiceDate
  - A client record is automatically created in a batch write with the user profile when a non-admin user signs in for the first time (`createdBy: 'self-signup'`). Admins can then enrich the record with address, notes, etc.

- **appointments** (calendar entries)
  - Fields: appointmentId, clientId, dateTime (ISO), serviceType (mow/trim/fertilize/etc.), durationMinutes, status (scheduled/completed/cancelled), notes, paymentStatus (pending/paid), paymentAmount, paymentDate, paidBy (cash/check)

- payments (optional sub-collection or denormalized field on appointment for simplicity)

All data stored in Firestore with indexes only where needed (date queries on appointments).

## Key Features & User Stories

**Admin Dashboard & Capabilities**

- **Calendar View** (FullCalendar.js integration)
  - Month/week/day views of all appointments.
  - Drag-and-drop reschedule, color-coded by status.
  - Filter by client or service type.

- **Create / Edit / Delete Appointments**
  - Form pre-fills client info; recurring option (simple weekly/bi-weekly checkbox).
  - Auto-generates confirmation on save.

- **Client / Contact Management**
  - CRUD on clients (searchable list + detail view).
  - View service history (list of past appointments).

- **Payment Tracking**
  - Mark appointment as “Paid” with amount, date, and method (cash/check).
  - Simple list/report of all unpaid/paid jobs (export to CSV via browser).

- **Bulk actions** limited to what fits free tier (e.g., mark multiple as paid).

**Customer Portal (Self-Service)**

- **My Dashboard** – shows upcoming appointments and past service history.
- **Profile Management** – edit phone, email, address (changes sync to client record).
- **Appointment View** – read-only detail; no self-booking (admin creates all slots to keep scheduling control).
- **Confirmation Receipt** – customers automatically receive email + SMS when an appointment is created or updated by admin.

**Notifications (Triggered by Cloud Functions)**

- **On appointment create/update:**
  - Email to customer (and optional admin copy) via SendGrid.
  - SMS to customer phone via Twilio (or similar low-cost gateway).

- **Template content:** “Your lawn-care appointment is confirmed for [date] at [time] at [address]. Questions? Reply to this message.”
- **No marketing emails** – only transactional confirmations.

## Non-Functional Requirements

- **Performance**: Instant real-time updates (Firestore listeners) for calendar changes.
- **Security:** All data protected by Firestore Security Rules + Custom Claims. No public read access.
- **Offline support:** Not required
- **Mobile optimization:** Ensure the web app is a progressive web app (PWA) with a manifest so the admin can "Add to Home screen"
- **Responsive design:** Bootstrap 5 ensures mobile-friendly experience for both admins (on tablet) and customers (on phone).
- **Time zones & location:** Always use America/Denver (Mountain Time) or let the admin set it; include full Roswell address in events
- **Monitoring & Limits:** Firebase console alerts for quota usage; app will show friendly “Contact admin” message if any limit is approached (never expected).

## Out-of-Scope (Future Phases)

When creating the application, also consider future upgrades:

- Google calendar sync
- Online payments / Stripe integration
- Full quoting / proposals
- Crew mobile app
- Multi-admin roles or permissions beyond admin/customer

## Placeholder TODOs

Search for `<!-- TODO` in `index.html` for all items that need real content:

- Contact form backend (Formspree recommended — add `action="https://formspree.io/f/YOUR_ID" method="POST"` to the `<form>` tag)

## Local Development

```bash
# Start emulators (hosting on localhost:5003, Firestore on 8080, Auth on 9099)
firebase emulators:start

# Emulator UI at http://localhost:4000
```

## Deploy

```bash
# Deploy hosting only
firebase deploy --only hosting

# Deploy Firestore rules + indexes
firebase deploy --only firestore

# Deploy everything (requires Blaze plan for functions)
firebase deploy

# Deploy preview channel
firebase hosting:channel:deploy preview
```

CI/CD via GitHub Actions automatically deploys on push to `main` (see `.github/workflows/`). The required GitHub secret is `FIREBASE_SERVICE_ACCOUNT_GRASSMASTERS`.

## Notes

- **Cloud Functions** (`functions/`) require upgrading to the **Firebase Blaze (pay-as-you-go)** plan. The Spark (free) tier does not support Cloud Functions. Notifications (SendGrid/Twilio) will only work after upgrade.
- **First admin account**: After creating the `grassmaster` user via Firebase Auth, run `bootstrapAdmin({email:'...'})` in the functions shell or emulator to grant admin custom claim.
- **Logo**: Original logo PDF is at `docs/logo.pdf`. SVG recreation at `public/images/logo.svg`.
