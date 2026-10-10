# CICARS 3310 — GitHub Pages + Firebase Realtime Database

## 1. Firebase project
1. Create a project at https://console.firebase.google.com/.
2. Add a **Web app** and copy its firebaseConfig values.
3. Build → Realtime Database → Create database; copy its databaseURL.
4. Build → Authentication → Sign-in method: enable **Anonymous** and **Email/Password**.
5. Create a dedicated admin user under Authentication → Users (email and a strong password). Copy this user's **UID**.
6. Edit `firebase-config.js`: fill apiKey, authDomain, databaseURL, projectId, appId, adminEmail, adminUid and set `enabled: true`.
7. Edit `firebase.rules.json`: replace `REPLACE_WITH_ADMIN_UID` with the admin UID. Paste the complete JSON into Realtime Database → Rules → Publish.
8. Do not publish the admin's password in HTML, JS, GitHub or rules. Enter it only in the site's ADMIN login. The demo password is for offline testing only and is **not secure**.

## 2. GitHub Pages
1. Create a GitHub repository (public for standard GitHub Pages access).
2. Upload all files in this folder to the repository root.
3. Settings → Pages → Deploy from a branch → main / (root) → Save.
4. Open the GitHub Pages URL on two browsers/devices. Both must use the same `sessionId` or `?room=room-name`.
5. Verify the status indicator says ONLINE, not DEMO or SYNC ERROR. If it says DEMO, there is **no** shared database.

## 3. Behavior
- Shared: console output, typed command draft, access-code draft, stage progression, unlocks, system effects and overlay animations.
- Local: which file modal is open, active tab, ambient music volume/toggle, and actual audio-file playback.
- Browser audio autoplay policies may require pressing ENABLE AUDIO once per device. No server can force sound playback without user interaction.
- Progress is stored in Firebase while online, and localStorage while offline. Online synchronization requires an Internet connection.
- The hidden `restore ARCHIVE` command is available after TEST 03. `import 3310` becomes available only after restoring the archive.
- `help`, `exit` and `clear` are not available as commands.
- ADMIN can trigger synchronized effects and skip to test stages. Online admin requires Firebase Email/Password authentication.

## Security note
This is a cooperative role-play application, not a tamper-proof examination. Client-side JavaScript can be inspected, and authenticated participants can modify shared input drafts. The Realtime Database rules restrict administrative commands to the configured UID, but they do not make story answers secret.
