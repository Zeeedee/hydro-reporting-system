# Setup And Deployment

## Purpose

This document explains how to set up HYDRO in a new Firebase project, retarget the repository configuration, prepare the bootstrap document, provision the first super admin, and verify that the system is ready for use.

This public repository is distributed with placeholder Firebase and Hosting values. Replace those placeholders with real project values before deployment.

## Prerequisites

- Node.js 20 or newer
- npm
- Firebase CLI
- Access to the Firebase Console for the target project

## Source Directories

| Path | Purpose |
| --- | --- |
| `public/` | Frontend source |
| `functions/` | Cloud Functions source |
| `dist/` | Hosting build output |
| `scripts/` | Build scripts |

`public/` is the frontend source of truth. `dist/` is rebuilt from `public/` and should not be edited directly.

## Recommended Setup Order

1. Create Firebase project
2. Enable required Firebase services
3. Create initial Authentication account from Firebase Console
4. Update Firebase and environment-specific config files
5. Set `APP_BASE_URL` for server-generated auth links
6. Install dependencies
7. Build the project
8. Deploy to Firebase
9. Prepare the bootstrap document
10. Complete first super-admin bootstrap
11. Run post-setup verification

## Create A Firebase Project

1. Open the Firebase Console.
2. Create a new Firebase project.
3. Add a Web App to the project.
4. Copy the Web App configuration values shown by Firebase.
5. Choose a Hosting site name and keep it available for the repo placeholder updates.

## Enable Required Firebase Services

Enable the services used by the current codebase in the Firebase Console:

1. Authentication -> Sign-in method -> enable Email/Password
2. Firestore Database -> Create database
3. Storage -> Get started and create the default bucket
4. Hosting -> Get started
5. App Check -> Register app and configure reCAPTCHA v3
6. Cloud Functions -> enabled automatically when functions are deployed, but the project must have billing and APIs ready if required by your Firebase plan

Current authentication requirements:

- Email/Password sign-in must be enabled.
- Admin multi-factor pages rely on Firebase Auth TOTP support.

## Create Initial Account (Required For Bootstrap)

Before anyone can use `/bootstrap.html`, create the first authentication account in Firebase Console.

Steps:

1. Open Firebase Console.
2. Go to Authentication -> Users.
3. Click `Add user`.
4. Create an Email/Password account.

Important notes:

- This account must exist before accessing `/bootstrap.html`.
- This account is the account that will be promoted to `super_admin` during bootstrap.
- No user can complete bootstrap without first signing in with an existing authenticated account.

## Configure Frontend Firebase Values

Update `public/js/firebase-config.js` with the values from the Firebase Web App you created.

After changing frontend Firebase config values, run `npm run build` so `dist/` is regenerated before deployment.

Template placeholder values to replace:

| Field | Placeholder in repository |
| --- | --- |
| `apiKey` | `YOUR_API_KEY` |
| `authDomain` | `YOUR_PROJECT.firebaseapp.com` |
| `projectId` | `YOUR_PROJECT_ID` |
| `storageBucket` | `YOUR_PROJECT.appspot.com` |
| `messagingSenderId` | `YOUR_SENDER_ID` |
| `appId` | `YOUR_APP_ID` |
| `measurementId` | `YOUR_MEASUREMENT_ID` |
| `APP_CHECK_SITE_KEY` | `YOUR_RECAPTCHA_SITE_KEY` |

Current fields that must be reviewed:

| Field | What it should match |
| --- | --- |
| `apiKey` | Firebase Web App API key |
| `authDomain` | New project auth domain, usually `<project-id>.firebaseapp.com` |
| `projectId` | New Firebase project ID |
| `storageBucket` | New Storage bucket |
| `messagingSenderId` | Web App sender ID |
| `appId` | Web App app ID |
| `measurementId` | Optional analytics value if used in the new project |
| `APP_CHECK_SITE_KEY` | reCAPTCHA v3 site key configured for the new Firebase App Check setup |

Important distinction in the current repository:

- The Firebase Web App values in `public/js/firebase-config.js` identify the Firebase project and frontend app.
- The Hosting site target in `firebase.json` controls where Hosting deploys.
- The action URL host in `public/js/auth/action-code-settings.js` and `functions/admin/index.js` controls where password reset and invited-account setup links send users.

All three must point to the same deployed HYDRO environment after retargeting.

`dist/` is deployment output. Do not edit files in `dist/` manually.

## App Check Configuration

The frontend initializes App Check from `public/js/firebase-config.js`, so the Firebase Console setup and the site key in the repository must match.

Setup steps:

1. Open Firebase Console.
2. Go to App Check.
3. Select the Web App used by HYDRO.
4. Register the app for App Check.
5. Choose reCAPTCHA v3.
6. Copy the reCAPTCHA v3 site key.
7. Place that site key in `public/js/firebase-config.js` as `APP_CHECK_SITE_KEY`.

Important notes:

- The site key must match the deployed domain used by HYDRO.
- If the key is configured for a different domain, App Check token requests can fail at runtime.
- The repository also supports overriding the key through `window.__HYDRO_APP_CHECK_SITE_KEY` or a meta tag, but the default value in `public/js/firebase-config.js` should still be reviewed during project retargeting.

## What To Change For A New Firebase Project

Update the following files together.

Template placeholders that must be replaced during retargeting:

| File | Placeholder |
| --- | --- |
| `.firebaserc` | `YOUR_PROJECT_ID` |
| `.firebaserc` target mapping | `YOUR_HOSTING_TARGET` -> `YOUR_HOSTING_SITE` |
| `firebase.json` | `hosting.site = YOUR_HOSTING_SITE` |
| `public/js/auth/action-code-settings.js` | uses `window.location.origin` |
| `functions/admin/index.js` | `process.env.APP_BASE_URL || 'http://localhost:5000/auth-action.html'` |

### `.firebaserc`

Current responsibilities:

- sets the default Firebase project alias
- maps the Hosting target alias to a specific Hosting site

What to change:

1. Replace `YOUR_PROJECT_ID` with the new Firebase project ID.
2. Replace `YOUR_HOSTING_TARGET` with the Hosting target alias you want to use.
3. Replace `YOUR_HOSTING_SITE` with the actual Hosting site name.

Example shape:

```json
{
  "projects": {
    "default": "your-new-project-id"
  },
  "targets": {
    "your-new-project-id": {
        "hosting": {
        "YOUR_HOSTING_TARGET": ["YOUR_HOSTING_SITE"]
      }
    }
  }
}
```

### `firebase.json`

Current responsibilities:

- points Hosting to `dist`
- points Functions to `functions`
- sets the Hosting site name
- runs the build automatically on Hosting deploy

What to change:

1. Replace `YOUR_HOSTING_SITE` with the actual Hosting site name.
2. Keep `hosting.public` as `dist` unless you intentionally change the deployment model.
3. Keep `functions.source` as `functions` unless the backend directory changes.
4. Review security headers if your new domain strategy changes.

### `public/js/firebase-config.js`

What to change:

1. Replace the placeholder Firebase Web App values with the new project's values.
2. Replace `YOUR_RECAPTCHA_SITE_KEY` with the reCAPTCHA v3 site key for the new web app.
3. Confirm the new Web App is the one connected to the deployed HYDRO site.

### `public/js/auth/action-code-settings.js`

Current behavior:

- uses `window.location.origin`
- builds the action URL for `auth-action.html`

What to change:

1. In the current public template, no hardcoded production domain remains here.
2. Keep the path pointed at `/auth-action.html` unless the route changes.
3. Confirm the deployed site serves the same route on the environment you want to use.

Current line to review:

```js
const actionHost = window.location.origin;
```

### `functions/admin/index.js`

Current behavior:

- `buildServerActionCodeSettings()` builds the password reset and invited-account setup link on the server side

What to change:

1. Set `APP_BASE_URL` in the deployment environment to the full deployed `auth-action.html` URL.
2. Keep the route pointed at `/auth-action.html` unless the frontend route changes.
3. Verify the setup link returned by `createUserByAdmin` opens the correct environment.

Current line to review:

```js
const base = process.env.APP_BASE_URL || 'http://localhost:5000/auth-action.html';
```

## APP_BASE_URL

`APP_BASE_URL` is the base URL used by Cloud Functions when generating password reset links and invited-account setup links on the server side.

Why it matters:

- `public/js/auth/action-code-settings.js` uses the current browser origin for client-side auth links.
- `functions/admin/index.js` cannot rely on the browser origin, so it uses `APP_BASE_URL` to build server-generated links.
- If `APP_BASE_URL` is missing or incorrect, admin-created invite/setup links can point to the wrong environment.

Where it is used:

- `functions/admin/index.js` in `buildServerActionCodeSettings()`

Example values:

- `https://your-project.web.app/auth-action.html`
- `https://your-project.firebaseapp.com/auth-action.html`
- `https://your-custom-domain.com/auth-action.html`

Current fallback in code:

- `http://localhost:5000/auth-action.html`

Deployment note:

- This repository does not include a checked-in deployment config file that sets `APP_BASE_URL` for you.
- Provide `APP_BASE_URL` through the Cloud Functions runtime environment used by your deployment process.
- After updating frontend Firebase values and any related deployment environment settings, run `npm run build` before deploying so `dist/` matches the configured frontend source.

## Install Dependencies

Install root dependencies:

```bash
npm ci
```

Install Cloud Functions dependencies:

```bash
npm ci --prefix functions
```

## Build The Hosting Output

Run the hosting build from the repository root:

```bash
npm run build
```

Current build behavior:

1. Deletes `dist/`.
2. Copies `public/` to `dist/`.
3. Minifies `dist/js/**/*.js` with `esbuild`.

## Deploy To Firebase

This public repository uses placeholders, so configure `.firebaserc`, `firebase.json`, frontend Firebase values, and `APP_BASE_URL` before running deploy commands.

Preferred default deploy command:

```bash
firebase deploy
```

Deploy hosting only:

```bash
firebase deploy --only hosting
```

If you are using Hosting targets and want a target-specific example:

```bash
firebase deploy --only hosting:YOUR_TARGET
```

Replace `YOUR_TARGET` with the Hosting target defined in `.firebaserc`.
If you are not using Hosting targets, use `firebase deploy --only hosting` instead.

Deploy functions only:

```bash
firebase deploy --only functions
```

Deploy Firestore rules, indexes, and Storage rules:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## Project Retargeting Checklist

Use this checklist when moving HYDRO to another Firebase project:

1. Create the new Firebase project.
2. Add the new Web App.
3. Enable Authentication, Firestore, Storage, Hosting, Functions, and App Check.
4. Create the initial Email/Password account in Firebase Authentication.
5. Update `.firebaserc` with the new project ID and Hosting target mapping.
6. Update `firebase.json` if the Hosting site name changes.
7. Update all Firebase Web App values in `public/js/firebase-config.js`.
8. Update the App Check site key in `public/js/firebase-config.js`.
9. Confirm `public/js/auth/action-code-settings.js` still resolves to the correct deployed origin.
10. Set `APP_BASE_URL` for Cloud Functions.
11. Run `npm ci` and `npm ci --prefix functions`.
12. Run `npm run build` so `dist/` is regenerated from the updated frontend source.
13. Deploy rules, indexes, functions, and hosting.
14. Prepare the bootstrap document before first super-admin provisioning.

## Bootstrap Setup (Step By Step)

The current bootstrap flow requires a Firestore document at the exact path below.

### Firestore document path

- Collection: `systemConfig`
- Document: `bootstrap`
- Full path: `systemConfig/bootstrap`

### Required fields

Create the document with these fields:

| Field | Type | Required value |
| --- | --- | --- |
| `bootstrapEnabled` | boolean | `true` |
| `bootstrapSecretHash` | string | SHA-256 hash of the bootstrap key you will enter on `/bootstrap.html` |

### Example Bootstrap Document

- Collection: `systemConfig`
- Document: `bootstrap`
- Full path: `systemConfig/bootstrap`

```json
{
  "bootstrapEnabled": true,
  "bootstrapSecretHash": "8f1c...example_sha256_hash_here"
}
```

Important notes:

- `bootstrapEnabled` must be `true` before bootstrap can succeed.
- `bootstrapSecretHash` is the SHA-256 hash of the raw bootstrap key.
- The raw bootstrap key must never be stored in Firestore.

### Bootstrap key requirements

The current backend accepts bootstrap keys only when they meet all of these rules:

- 12 to 128 characters
- letters, numbers, underscore, and hyphen only
- no spaces

Example valid key:

```text
CampusBootstrap_2026
```

## How To Generate `bootstrapSecretHash`

Choose a raw bootstrap key first. Generate its SHA-256 hash, store only the hash in Firestore, and enter the original raw key later in `/bootstrap.html`.

### PowerShell

Replace `YOUR_BOOTSTRAP_KEY` with your chosen key:

```powershell
$key = 'YOUR_BOOTSTRAP_KEY'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($key)
$hashBytes = [System.Security.Cryptography.SHA256]::HashData($bytes)
($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

### Node.js

Replace `YOUR_BOOTSTRAP_KEY` with your chosen key:

```bash
node -e "const crypto=require('crypto'); console.log(crypto.createHash('sha256').update('YOUR_BOOTSTRAP_KEY','utf8').digest('hex'))"
```

### What goes into Firestore

- `bootstrapEnabled` should be `true`
- `bootstrapSecretHash` should be the hash output from one of the commands above
- do not store the raw bootstrap key in Firestore

## First Super Admin Provisioning Walkthrough

Use the current implementation flow below.

1. Create the Firebase project and configure the repository values.
2. Create the initial Email/Password account in Firebase Console.
3. Set `APP_BASE_URL` for the deployed environment.
4. Build and deploy the project first.
5. Create the Firestore collection `systemConfig` if it does not already exist.
6. Create the document `bootstrap`.
7. Set `bootstrapEnabled` to `true`.
8. Set `bootstrapSecretHash` to the SHA-256 hash of your chosen bootstrap key.
9. Sign in on the deployed HYDRO site using the account created in Firebase Console.
10. Open `/bootstrap.html` on the deployed HYDRO site.
11. Enter the original bootstrap key, not the hash.
12. Submit the form.
13. On success, the signed-in user becomes `super_admin`.
14. Confirm bootstrap is disabled afterward by checking that `bootstrapEnabled` is now `false` and `lockedAt` has been written.

## Post-Setup Verification Checklist

After setup, confirm the environment matches the current code expectations:

1. `firebase.json` still points Hosting to `dist` and Functions to `functions`.
2. `npm run build` completes successfully.
3. The deployed site loads from the expected Hosting domain.
4. Login works with Email/Password auth.
5. Password reset links open the correct deployed `auth-action.html` page.
6. Admin invite setup links open the correct deployed `auth-action.html?flow=setup` page.
7. `APP_BASE_URL` points to the same deployed environment used for admin-generated auth links.
8. App Check initializes without a domain mismatch error.
9. The bootstrap document exists at `systemConfig/bootstrap` before first super-admin provisioning.
10. Bootstrap succeeds only with the original raw bootstrap key.
11. The first bootstrapped user is routed into the admin experience.
12. Bootstrap disables itself afterward by setting `bootstrapEnabled` to `false`.

## Local Development With Emulators

Start the emulator suite:

```bash
firebase emulators:start
```

Configured ports:

| Service | Port |
| --- | --- |
| Auth | `9099` |
| Functions | `5001` |
| Firestore | `8080` |
| Storage | `9199` |
| Hosting | `5000` |
| Emulator UI | `4000` |

## Operational Notes

- Public sign-up is disabled in the current implementation.
- Invited accounts complete setup through `auth-action.html`.
- `public/js/auth/action-code-settings.js` and `functions/admin/index.js` must stay aligned so client-side reset links and server-generated setup links open the same deployed environment.
- `APP_BASE_URL` must point to the deployed `auth-action.html` route used by Cloud Functions when generating invite and reset links.
- `bootstrapSecretHash` is always the SHA-256 hash of the raw bootstrap key entered later on `/bootstrap.html`.
- `dist/` is a build artifact and should always be rebuilt from `public/`.
