// Email + password auth helpers.

async function signUp(email, password) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  return cred.user;
}

async function signIn(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

async function signOutUser() {
  await auth.signOut();
  window.location.href = "index.html";
}

async function sendPasswordReset(email) {
  await auth.sendPasswordResetEmail(email);
}

async function updateProfile(uid, updates) {
  await db.collection("users").doc(uid).update(updates);
}

async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("Not signed in.");
  const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
  await user.reauthenticateWithCredential(credential);
  await user.updatePassword(newPassword);
}

// Wait for auth state, return current user (or null)
function waitForAuth() {
  return new Promise(function (resolve) {
    const unsubscribe = auth.onAuthStateChanged(function (user) {
      unsubscribe();
      resolve(user);
    });
  });
}

// Friendly error messages for common Firebase auth errors
function friendlyAuthError(err) {
  const code = (err && err.code) || "";
  switch (code) {
    case "auth/invalid-email": return "That doesn't look like a valid email.";
    case "auth/email-already-in-use": return "An account with this email already exists. Try logging in.";
    case "auth/weak-password": return "Password is too weak. Use at least 6 characters.";
    case "auth/user-not-found": return "No account with this email. Try signing up.";
    case "auth/wrong-password": return "Wrong password. Try again.";
    case "auth/invalid-credential": return "Wrong email or password.";
    case "auth/too-many-requests": return "Too many attempts. Wait a minute and try again.";
    case "auth/network-request-failed": return "Network error. Check your internet connection.";
    default: return (err && err.message) || "Something went wrong. Try again.";
  }
}
