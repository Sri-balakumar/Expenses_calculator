# Monthly Expense Calculator

A simple web app to track monthly expenses. Works on laptop + phone, with cloud storage so your data never gets lost.

**Stack:** HTML + CSS + vanilla JavaScript + Firebase Firestore. Hosted free on GitHub Pages.

---

## How it Works

1. **Sign up** with email + password + your name + monthly salary
2. **Dashboard**: see your name, salary, and a list of months
3. **Tap "+ New Month"** to create a month (e.g. "May 2026")
4. **Inside a month**: add expenses with the **+** (income) or **−** (spend) button
5. The total updates live and shows how much you have remaining
6. **Log in from any device** — your data syncs through Firebase

---

## Setup (one-time, ~5 minutes)

### Step 1 — Create a Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → name it anything (e.g. "expense-app") → continue → continue → create
3. Once the project is ready, click the **Web icon** (looks like `</>`) on the project home page
4. Register the app (give it a nickname like "expense-web") → **Register**
5. You'll see a code snippet containing a `firebaseConfig` object. **Copy the whole object.**

### Step 2 — Paste the config into the code

1. Open `js/firebase.js`
2. Replace the placeholder `firebaseConfig` object with the one you copied
3. Save the file

### Step 3 — Enable Firestore Database

1. In the Firebase Console, go to **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in test mode** (you can secure it later) → **Next**
4. Pick a region close to you (e.g. `asia-south1` for India) → **Enable**

### Step 4 — Enable Email/Password Sign-In

1. In the Firebase Console, go to **Build → Authentication**
2. Click **Get started**
3. Under **Sign-in method**, click **Email/Password**
4. Turn ON the first toggle: **Email/Password** → **Save**

### Step 5 — Test locally

1. Open the project in VS Code → right-click `index.html` → **Open with Live Server**
   - Or run: `python -m http.server 8000` and visit `http://localhost:8000`
   - Or just double-click `index.html`
2. Click the **Sign Up** tab → enter email + password + name + salary → **Create account**
3. You'll land on the dashboard. Tap **+ New Month** → add some expenses!
4. Sign out and log back in to confirm it works.

---

## Deploy to GitHub Pages

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial expense calculator"
```

Create a new repo on **github.com** (don't add a README — you already have one), then:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 2 — Enable GitHub Pages

1. On GitHub, go to your repo → **Settings** → **Pages**
2. Under **Source**, choose **Deploy from a branch**
3. Branch: **main**, Folder: **/ (root)** → **Save**
4. Wait ~1 minute. Your site will be live at:
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### Step 3 — Done!

That's it. Email/password sign-in works on any domain by default, so no extra Firebase steps are needed.

---

## File Structure

```
Expense_calculator/
├── index.html          Landing page (email sign-in + first-time profile)
├── dashboard.html      Shows greeting, salary, list of months
├── month.html          Single month: expense list + total + add form
├── css/
│   └── style.css       Shared styles
├── js/
│   ├── firebase.js     Firebase init (YOU edit this with your config)
│   ├── auth.js         Email magic-link helpers
│   ├── dashboard.js    Dashboard logic
│   └── month.js        Month page logic
└── README.md           This file
```

---

## Data Model (Firestore)

```
users/{userId}
  ├─ name
  ├─ salary
  ├─ email
  └─ months/{monthId}
       ├─ name
       └─ expenses/{expenseId}
            ├─ name
            ├─ amount
            └─ type   ("plus" or "minus")
```

---

## Security (later)

The default Firestore rules in test mode expire after 30 days. Before that, replace them with rules that only let users read/write their own data. In Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Notes

- Free Firebase tier is more than enough for personal use (50K reads/day, 20K writes/day).
- Sign up once, then log in on laptop AND phone using the same email/password — your data syncs.
- All data lives in Firebase Firestore (Google Cloud) — survives clearing browser cache.

---

## 📱 Install as a PWA (Progressive Web App)

This app is now installable on your phone or laptop — no app store, no build step.

### What you get
- App icon on your home screen / desktop
- Opens in its own window (no browser bar)
- Works offline (cached app shell + Firestore offline persistence)
- Faster startup

### How to install

**Android (Chrome / Edge / Brave):**
1. Open the deployed site (e.g. `https://yourname.github.io/Expense_calculator/`)
2. Tap the menu (⋮) → **Install app** / **Add to Home screen**
3. Or wait for the floating **Install** button at the bottom-right of the page — tap it

**iPhone / iPad (Safari only — Chrome on iOS can't install PWAs):**
1. Open the site in **Safari**
2. Tap the **Share** button (square with up arrow)
3. Scroll → tap **Add to Home Screen**
4. Tap **Add**

**Desktop (Chrome / Edge):**
1. Look for the install icon in the address bar (small computer/download icon)
2. Click → **Install**
3. Or wait for the floating Install button on the page

### Files that make this a PWA
- `manifest.json` — app name, icons, colors
- `service-worker.js` — caches the app shell for offline use
- `icons/icon.svg` — app icon
- `js/pwa.js` — registers the service worker + shows install button

### No build step required

Everything is plain HTML/CSS/JS. To deploy:

```bash
git add .
git commit -m "Add PWA support"
git push
```

GitHub Pages re-publishes automatically. PWA install becomes available within minutes.

### Better icons (optional)

The default icon is an SVG (the ₹ symbol on a gradient). For best Android compatibility, convert it to PNG and add:
- `icons/icon-192.png` (192×192)
- `icons/icon-512.png` (512×512)

Easy way: open `icons/icon.svg` in your browser → screenshot → resize with any image tool → save as PNG. Or use a free tool like https://cloudconvert.com/svg-to-png.
