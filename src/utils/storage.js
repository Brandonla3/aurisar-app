import { sb } from './supabase';
import { STORAGE_KEY } from '../data/constants';

async function loadSave(userId) {
  if(userId) {
    try {
      // Race Supabase against a 4s timeout
      const supabaseLoad = sb.from("profiles").select("data").eq("id",userId).single();
      const timeout = new Promise((_,reject) => setTimeout(()=>reject(new Error("timeout")), 4000));
      const {data,error} = await Promise.race([supabaseLoad, timeout]);
      // PGRST116 = no row found (new user with no saved profile yet) — return null cleanly
      if(!error || error.code === "PGRST116") return data?.data ?? null;
    } catch(e) {
      // Timeout or network error — return null rather than leaking another user's localStorage data
    }
    return null;
  }
  // No userId — unauthenticated/offline fallback only
  try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch(e) { return null; }
}

// ── Coalesced remote save ──────────────────────────────────────────────
// localStorage writes stay eager (cheap, sync, safe on tab close).
// Supabase upserts are debounced to 500ms so rapid profile mutations
// (e.g. typing in the onboarding form, logging consecutive sets) coalesce
// into one network round-trip. flushSave() forces an immediate flush —
// callers can use it before sign-out or other critical transitions.
const SUPABASE_DEBOUNCE_MS = 500;
let _pending = null;        // latest payload waiting to be sent
let _timerId = null;
let _inFlight = null;       // promise of the currently-running upsert

async function _flush() {
  _timerId = null;
  if (!_pending) return;
  const payload = _pending;
  _pending = null;
  // Chain after any in-flight write so we never interleave upserts.
  _inFlight = (async () => {
    try { await sb.from("profiles").upsert(payload); } catch(e) { /* swallowed; localStorage is the safety net */ }
  })();
  try { await _inFlight; } finally { _inFlight = null; }
  // If another save was queued while we were flushing, drain it.
  if (_pending && !_timerId) _timerId = setTimeout(_flush, 0);
}

async function flushSave() {
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  await _flush();
  if (_inFlight) await _inFlight;
}

async function doSave(data, userId, userEmail) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
  if (!userId) return;
  const saveData = userEmail ? {...data, email: userEmail.toLowerCase()} : data;
  _pending = { id: userId, data: saveData, updated_at: new Date().toISOString() };
  if (_timerId) clearTimeout(_timerId);
  _timerId = setTimeout(_flush, SUPABASE_DEBOUNCE_MS);
}

// Best-effort flush on tab hide / unload so users don't lose the last
// ~500ms of edits if they close the tab right after a change.
if (typeof window !== 'undefined') {
  const onHide = () => { if (_pending) flushSave(); };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
}

export { loadSave, doSave, flushSave };
