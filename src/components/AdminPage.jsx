import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../utils/supabase';

/* ═══════════════════════════════════════════════════════════════
   Aurisar — Admin Panel
   Accessible only when profiles.is_admin = true (set server-side).
   All write operations go through /api/admin/* Netlify functions
   using the service-role key; the frontend only holds the user's
   Bearer token (anon-scoped) to call those endpoints.
   ═══════════════════════════════════════════════════════════════ */

const API = {
  listUsers:    "/api/admin/list-users",
  deprovision:  "/api/admin/deprovision-user",
  reinstate:    "/api/admin/reinstate-user",
  deleteUser:   "/api/admin/delete-user",
  resetMfa:     "/api/admin/reset-mfa",
  sendInvite:   "/api/admin/send-invite",
};

async function adminFetch(url, { method = "GET", token, body } = {}) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

// ── Tiny reusable status pill ─────────────────────────────────────────────────
function StatusPill({ user }) {
  if (user.is_admin) {
    return <span style={pill("rgba(196,148,40,.2)", "#c49428")}>Admin</span>;
  }
  if (user.disabled_at) {
    return <span style={pill("rgba(122,40,56,.25)", "#c47878")}>Disabled</span>;
  }
  return <span style={pill("rgba(60,120,60,.2)", "#7ab07a")}>Active</span>;
}

function pill(bg, color) {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: ".65rem",
    fontWeight: 700,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    background: bg,
    color,
    border: `1px solid ${color}22`,
  };
}

// ── Confirmation modal ────────────────────────────────────────────────────────
function ConfirmModal({ title, body, confirmLabel, confirmDanger, onConfirm, onCancel, children }) {
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,.72)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "linear-gradient(145deg, rgba(45,42,36,.97) 0%, rgba(28,26,20,.98) 100%)",
        border: "1px solid rgba(180,172,158,.12)",
        borderRadius: 12,
        padding: "28px 24px",
      }}>
        <h3 style={{ margin: "0 0 10px", fontSize: "1rem", color: "#d4cec4", fontWeight: 700 }}>
          {title}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: ".85rem", color: "#8a8478", lineHeight: 1.5 }}>
          {body}
        </p>
        {children}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button style={ghostBtn()} onClick={onCancel}>Cancel</button>
          <button
            style={confirmDanger ? dangerBtn() : goldBtn()}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── MFA reset dropdown ────────────────────────────────────────────────────────
function MfaMenu({ user, token, onDone, onError }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const reset = async (factor) => {
    setLoading(factor);
    setOpen(false);
    try {
      await adminFetch(API.resetMfa, { method: "POST", token, body: { userId: user.id, factor } });
      onDone(`✓ ${factor === "all" ? "All MFA factors" : factor.toUpperCase()} reset for ${user.player_name || user.email}`);
    } catch (e) {
      onError(`Failed to reset ${factor} MFA: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const options = [
    { label: "TOTP (Authenticator App)", factor: "totp" },
    { label: "SMS / Phone",              factor: "phone" },
    { label: "Passkey",                  factor: "passkey" },
    { label: "All Factors",              factor: "all" },
  ];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        style={actionBtn()}
        onClick={() => setOpen(o => !o)}
        disabled={!!loading}
      >
        {loading ? "…" : "Reset 2FA ▾"}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 1000,
          background: "rgba(28,26,20,.98)",
          border: "1px solid rgba(180,172,158,.15)",
          borderRadius: 8,
          minWidth: 190,
          boxShadow: "0 4px 20px rgba(0,0,0,.5)",
          overflow: "hidden",
        }}>
          {options.map(({ label, factor }) => (
            <button
              key={factor}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 14px",
                fontSize: ".78rem", color: factor === "all" ? "#c49428" : "#d4cec4",
                background: "transparent",
                border: "none", borderBottom: "1px solid rgba(180,172,158,.06)",
                cursor: "pointer",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(196,148,40,.08)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              onClick={() => reset(factor)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────
function UserRow({ user, token, currentUserId, onRefresh, onToast }) {
  const [confirm, setConfirm] = useState(null); // null | 'disable' | 'reinstate' | 'delete'
  const [deleteEmail, setDeleteEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const isSelf = user.id === currentUserId;

  const doAction = async (action, body) => {
    setBusy(true);
    try {
      await adminFetch(API[action], { method: "POST", token, body });
      onToast(`✓ Done`);
      onRefresh();
    } catch (e) {
      onToast(`✗ ${e.message}`, true);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const handleResetPassword = async () => {
    setBusy(true);
    try {
      const { error } = await sb.auth.resetPasswordForEmail(user.email, {
        redirectTo: "https://aurisargames.com",
      });
      if (error) throw new Error(error.message);
      onToast(`✓ Password reset email sent to ${user.email}`);
    } catch (e) {
      onToast(`✗ ${e.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={rowStyle(user.disabled_at)}>
        {/* Identity */}
        <div style={{ flex: "0 0 auto", minWidth: 0 }}>
          <div style={{ fontSize: ".85rem", fontWeight: 700, color: "#d4cec4", marginBottom: 2 }}>
            {user.player_name || <em style={{ color: "#5a5650" }}>No name</em>}
          </div>
          <div style={{ fontSize: ".7rem", color: "#8a8478", wordBreak: "break-all" }}>
            {user.email}
          </div>
          {user.public_id && (
            <div style={{ fontSize: ".62rem", color: "#5a5650", marginTop: 1 }}>#{user.public_id}</div>
          )}
        </div>

        {/* Status */}
        <div style={{ flex: "0 0 auto", textAlign: "center" }}>
          <StatusPill user={user} />
          <div style={{ fontSize: ".6rem", color: "#5a5650", marginTop: 4 }}>
            {user.last_sign_in_at
              ? new Date(user.last_sign_in_at).toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" })
              : "Never"}
          </div>
        </div>

        {/* Actions */}
        {!isSelf && (
          <div style={{ flex: "0 0 auto", display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={actionBtn()} onClick={handleResetPassword} disabled={busy}>
              Reset PW
            </button>

            <MfaMenu
              user={user}
              token={token}
              onDone={msg => onToast(msg)}
              onError={msg => onToast(msg, true)}
            />

            {user.disabled_at ? (
              <button style={actionBtn()} onClick={() => setConfirm("reinstate")} disabled={busy}>
                Reinstate
              </button>
            ) : (
              <button style={actionBtn()} onClick={() => setConfirm("disable")} disabled={busy}>
                Disable
              </button>
            )}

            <button style={dangerSmallBtn()} onClick={() => { setDeleteEmail(""); setConfirm("delete"); }} disabled={busy}>
              Delete
            </button>
          </div>
        )}
        {isSelf && (
          <div style={{ flex: "0 0 auto", fontSize: ".65rem", color: "#5a5650", fontStyle: "italic" }}>
            (you)
          </div>
        )}
      </div>

      {/* Confirmation modals */}
      {confirm === "disable" && (
        <ConfirmModal
          title="Disable this account?"
          body={`${user.player_name || user.email} will be immediately signed out and blocked from signing in. You can reinstate them at any time.`}
          confirmLabel="Disable Account"
          confirmDanger
          onConfirm={() => doAction("deprovision", { userId: user.id })}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm === "reinstate" && (
        <ConfirmModal
          title="Reinstate this account?"
          body={`${user.player_name || user.email} will be able to sign in again immediately.`}
          confirmLabel="Reinstate"
          onConfirm={() => doAction("reinstate", { userId: user.id })}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm === "delete" && (
        <ConfirmModal
          title="Permanently delete this account?"
          body={`This is irreversible. All data for ${user.player_name || user.email} will be deleted. Type their email address to confirm.`}
          confirmLabel="Permanently Delete"
          confirmDanger
          onConfirm={() => {
            if (deleteEmail.toLowerCase() !== user.email?.toLowerCase()) {
              onToast("✗ Email does not match", true);
              return;
            }
            doAction("deleteUser", { userId: user.id, confirmEmail: deleteEmail });
          }}
          onCancel={() => setConfirm(null)}
        >
          <input
            className="inp"
            style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }}
            placeholder={`Type ${user.email} to confirm`}
            value={deleteEmail}
            onChange={e => setDeleteEmail(e.target.value)}
            autoComplete="off"
          />
        </ConfirmModal>
      )}
    </>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────
function InviteModal({ token, onClose, onToast }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await adminFetch(API.sendInvite, { method: "POST", token, body: { email: email.trim() } });
      onToast(`✓ Invite sent to ${email.trim()}`);
      onClose();
    } catch (e) {
      onToast(`✗ ${e.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,.72)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        width: "100%", maxWidth: 380,
        background: "linear-gradient(145deg, rgba(45,42,36,.97) 0%, rgba(28,26,20,.98) 100%)",
        border: "1px solid rgba(180,172,158,.12)",
        borderRadius: 12,
        padding: "28px 24px",
      }}>
        <h3 style={{ margin: "0 0 10px", fontSize: "1rem", color: "#d4cec4", fontWeight: 700 }}>
          Send Invite
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: ".82rem", color: "#8a8478", lineHeight: 1.5 }}>
          A branded invite link (valid 7 days) will be sent via email.
        </p>
        <input
          className="inp"
          style={{ width: "100%", boxSizing: "border-box" }}
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          autoFocus
          autoComplete="off"
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button style={ghostBtn()} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={goldBtn()} onClick={send} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send Invite"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main AdminPage component ──────────────────────────────────────────────────
export default function AdminPage({ authUser, onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null); // { msg, isErr }
  const [showInvite, setShowInvite] = useState(false);
  const [token, setToken] = useState(null);

  // Grab the current session token once
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? null);
    });
  }, []);

  const loadUsers = useCallback(async (tok) => {
    setLoading(true);
    setLoadErr(null);
    try {
      const { users: list } = await adminFetch(API.listUsers, { token: tok });
      setUsers(list || []);
    } catch (e) {
      setLoadErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) loadUsers(token);
  }, [token, loadUsers]);

  const showToast = (msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      u.email?.toLowerCase().includes(q) ||
      u.player_name?.toLowerCase().includes(q) ||
      u.public_id?.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse 70% 55% at 30% 20%, rgba(55,48,36,.22) 0%, transparent 65%), #0c0c0a",
      color: "#d4cec4",
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(12,12,10,.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(180,172,158,.08)",
        padding: "12px 20px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button
          style={{ ...ghostBtn(), padding: "6px 12px", fontSize: ".75rem" }}
          onClick={onBack}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: ".62rem", letterSpacing: ".3em", color: "#8a8478", textTransform: "uppercase" }}>
            Aurisar
          </div>
          <div style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: ".12em", color: "#c49428" }}>
            Admin Panel
          </div>
        </div>
        <button style={goldBtn()} onClick={() => setShowInvite(true)}>
          + Invite User
        </button>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>

        {/* Search bar */}
        <div style={{ marginBottom: 20 }}>
          <input
            className="inp"
            style={{ width: "100%", boxSizing: "border-box" }}
            placeholder="Search by name, email, or Account ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          {[
            { label: "Total Users",    value: users.length },
            { label: "Active",         value: users.filter(u => !u.disabled_at && !u.is_admin).length },
            { label: "Disabled",       value: users.filter(u => u.disabled_at).length },
            { label: "Admins",         value: users.filter(u => u.is_admin).length },
          ].map(({ label, value }) => (
            <div key={label} style={statCard()}>
              <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#c49428" }}>{value}</div>
              <div style={{ fontSize: ".62rem", color: "#8a8478", letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* User list */}
        {loading && (
          <div style={{ textAlign: "center", color: "#8a8478", fontSize: ".78rem", padding: "40px 0" }}>
            Loading warriors…
          </div>
        )}
        {loadErr && (
          <div style={{ color: "#c47878", fontSize: ".82rem", padding: "20px 0" }}>
            ✗ {loadErr}
            <button style={{ ...ghostBtn(), marginLeft: 12, padding: "4px 12px", fontSize: ".72rem" }} onClick={() => loadUsers(token)}>
              Retry
            </button>
          </div>
        )}
        {!loading && !loadErr && (
          <>
            {/* Column header */}
            <div style={{ ...rowStyle(), borderBottom: "1px solid rgba(180,172,158,.12)", paddingBottom: 8, marginBottom: 4 }}>
              <div style={{ flex: "0 0 auto", fontSize: ".62rem", color: "#5a5650", letterSpacing: ".1em", textTransform: "uppercase" }}>
                Player / Email
              </div>
              <div style={{ flex: "0 0 auto", fontSize: ".62rem", color: "#5a5650", letterSpacing: ".1em", textTransform: "uppercase", textAlign: "center" }}>
                Status
              </div>
              <div style={{ flex: "0 0 auto", fontSize: ".62rem", color: "#5a5650", letterSpacing: ".1em", textTransform: "uppercase", textAlign: "right" }}>
                Actions
              </div>
            </div>

            {filtered.length === 0 && (
              <div style={{ color: "#5a5650", fontSize: ".78rem", padding: "32px 0", textAlign: "center" }}>
                {search ? "No users match your search." : "No users found."}
              </div>
            )}

            {filtered.map(u => (
              <UserRow
                key={u.id}
                user={u}
                token={token}
                currentUserId={authUser.id}
                onRefresh={() => loadUsers(token)}
                onToast={showToast}
              />
            ))}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          zIndex: 3000,
          background: toast.isErr ? "rgba(122,40,56,.95)" : "rgba(40,60,40,.95)",
          border: `1px solid ${toast.isErr ? "rgba(196,120,120,.3)" : "rgba(120,176,120,.3)"}`,
          color: toast.isErr ? "#e8a0a0" : "#a0d0a0",
          padding: "10px 20px",
          borderRadius: 8,
          fontSize: ".8rem",
          fontWeight: 600,
          maxWidth: "90vw",
          textAlign: "center",
          boxShadow: "0 4px 20px rgba(0,0,0,.5)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <InviteModal
          token={token}
          onClose={() => setShowInvite(false)}
          onToast={showToast}
        />
      )}
    </div>
  );
}

// ── Style helpers (keep consistent with app's design system) ─────────────────
function rowStyle(disabled) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    marginBottom: 4,
    background: disabled
      ? "rgba(122,40,56,.06)"
      : "rgba(45,42,36,.3)",
    border: "1px solid rgba(180,172,158,.06)",
    opacity: disabled ? 0.7 : 1,
  };
}

function statCard() {
  return {
    flex: "1 1 100px",
    background: "rgba(45,42,36,.4)",
    border: "1px solid rgba(180,172,158,.08)",
    borderRadius: 10,
    padding: "12px 16px",
    textAlign: "center",
  };
}

function goldBtn() {
  return {
    padding: "8px 16px",
    background: "rgba(196,148,40,.15)",
    color: "#c49428",
    border: "1px solid rgba(196,148,40,.25)",
    borderRadius: 7,
    fontSize: ".75rem",
    fontWeight: 700,
    letterSpacing: ".06em",
    cursor: "pointer",
    textTransform: "uppercase",
  };
}

function ghostBtn() {
  return {
    padding: "8px 14px",
    background: "transparent",
    color: "#8a8478",
    border: "1px solid rgba(180,172,158,.15)",
    borderRadius: 7,
    fontSize: ".75rem",
    cursor: "pointer",
  };
}

function actionBtn() {
  return {
    padding: "5px 10px",
    background: "rgba(45,42,36,.6)",
    color: "#b4ac9e",
    border: "1px solid rgba(180,172,158,.12)",
    borderRadius: 6,
    fontSize: ".72rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function dangerBtn() {
  return {
    padding: "8px 16px",
    background: "rgba(122,40,56,.25)",
    color: "#c47878",
    border: "1px solid rgba(196,120,120,.25)",
    borderRadius: 7,
    fontSize: ".75rem",
    fontWeight: 700,
    letterSpacing: ".06em",
    cursor: "pointer",
    textTransform: "uppercase",
  };
}

function dangerSmallBtn() {
  return {
    padding: "5px 10px",
    background: "rgba(122,40,56,.2)",
    color: "#c47878",
    border: "1px solid rgba(196,120,120,.15)",
    borderRadius: 6,
    fontSize: ".72rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
