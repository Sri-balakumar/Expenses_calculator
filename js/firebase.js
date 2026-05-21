// ============================================================
// FIREBASE CONFIG — REPLACE THE VALUES BELOW WITH YOUR OWN
// ============================================================
// 1. Go to https://console.firebase.google.com
// 2. Create a project → Click "Web" icon (</>) → Register app
// 3. Copy the firebaseConfig object → paste it here
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyApu04Oa4r1kdgJSyy8nvrCVEqH-GVBdc8",
  authDomain: "expense-app-280ee.firebaseapp.com",
  projectId: "expense-app-280ee",
  storageBucket: "expense-app-280ee.firebasestorage.app",
  messagingSenderId: "265762763918",
  appId: "1:265762763918:web:eb917b17450c164978c5df",
  measurementId: "G-3GYSV0VG7D"
};

// Initialize Firebase (compat SDK loaded via <script> in each HTML file)
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Enable offline persistence so the app keeps working without internet.
// Browsers with multiple tabs may reject this — that's fine; the app still works online.
db.enablePersistence({ synchronizeTabs: true }).catch(function () {});

// Helper: get current user id (or null)
function currentUserId() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

// Helper: format ₹ amount
function formatMoney(amount) {
  const n = Number(amount) || 0;
  return "₹" + n.toLocaleString("en-IN");
}
