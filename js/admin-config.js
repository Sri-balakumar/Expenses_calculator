// Admin configuration — single source of truth for who is admin.

const ADMIN_EMAIL = "sribalakumarr@gmail.com";

function isAdminEmail(email) {
  return (email || "").trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function isAdmin(user) {
  return !!user && isAdminEmail(user.email);
}
