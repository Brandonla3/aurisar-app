import { useState, useMemo } from 'react';
import aurisarLogo from '../assets/aurisar-logo.png';

// ─── Ambient particles + vignette + grain ─────────────────────────────────────
function Ambient({ animated = true, density = 28 }) {
  const motes = useMemo(() => Array.from({ length: density }, () => ({
    left: Math.random() * 100,
    delay: -Math.random() * 22,
    dur: 18 + Math.random() * 16,
    drift: (Math.random() - 0.5) * 80,
    size: 1 + Math.random() * 1.8,
  })), [density]);

  return (
    <div className="au-ambient" aria-hidden="true">
      <div className="au-vignette" />
      <div className="au-grain" />
      {animated && (
        <div className="au-motes">
          {motes.map((m, i) => (
            <div key={i} className="au-mote" style={{
              left: `${m.left}%`,
              bottom: '-10px',
              width: `${m.size}px`,
              height: `${m.size}px`,
              animationDelay: `${m.delay}s`,
              animationDuration: `${m.dur}s`,
              '--mote-drift': `${m.drift}px`,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SVG glyphs ───────────────────────────────────────────────────────────────
function Glyph({ name, size = 14 }) {
  const s = size;
  if (name === 'warn') return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5L13 12H1L7 1.5z" /><path d="M7 5.5v3M7 10.4v.1" />
    </svg>
  );
  if (name === 'sword') return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M12.2 1.8L6 8l-1.4-1.4L10.8.4 12.2 1.8zM6 8l-3.6 3.6 1.4 1.4L7.4 9.4 6 8zM3.4 11.4l-1.6 1.6M5.2 9.6l1.4 1.4" />
    </svg>
  );
  if (name === 'key') return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="4.5" cy="7" r="2.6" />
      <path d="M7 7h6M11 7v2.2M9.5 7v1.6" />
    </svg>
  );
  if (name === 'check') return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5l3 3 6-6.5" />
    </svg>
  );
  if (name === 'plus') return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
  if (name === 'back') return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3L4 7l5 4" />
    </svg>
  );
  return null;
}

// ─── LoginScreen ──────────────────────────────────────────────────────────────
export default function LoginScreen({
  // auth form state
  authEmail, setAuthEmail,
  authPassword, setAuthPassword,
  showAuthPw, setShowAuthPw,
  authIsNew, setAuthIsNew,
  authRemember, setAuthRemember,
  authLoading,
  authMsg, setAuthMsg,
  // sub-screens
  loginSubScreen, setLoginSubScreen,
  forgotPwEmail, setForgotPwEmail,
  forgotPrivateId, setForgotPrivateId,
  forgotLookupResult, setForgotLookupResult,
  // preview mode
  PREVIEW_ENABLED,
  previewPinEnabled,
  showPreviewPin, setShowPreviewPin,
  previewPinInput, setPreviewPinInput,
  previewPinError, setPreviewPinError,
  PREVIEW_PIN,
  launchPreviewMode,
  // handlers
  onSubmit,
  onBack,
  sendPasswordReset,
  lookupByPrivateId,
}) {
  const cardTitle = loginSubScreen === 'forgot-pw'
    ? 'Reset Password'
    : loginSubScreen === 'forgot-username'
    ? 'Find Your Account'
    : authIsNew
    ? 'Forge a Profile'
    : 'Sign In';

  return (
    <div className="au-stage" style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
    }}>
      {/* ── Layered cinematic background ── */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background: `
          radial-gradient(120% 100% at 70% 30%, oklch(0.22 0.04 75 / 0.5), transparent 55%),
          radial-gradient(80% 60% at 20% 80%, oklch(0.10 0.005 60 / 1), transparent 60%),
          linear-gradient(180deg, oklch(0.10 0.008 60), oklch(0.06 0.005 60))
        `,
      }}>
        {/* Ghost sigil */}
        <div style={{
          position: 'absolute',
          right: '-14%',
          top: '50%',
          transform: 'translateY(-50%)',
          width: 'min(1180px, 160vh)',
          aspectRatio: '1',
          opacity: 0.22,
          maskImage: 'radial-gradient(closest-side, #000 45%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(closest-side, #000 45%, transparent 80%)',
          pointerEvents: 'none',
        }}>
          <img src={aurisarLogo} alt="" style={{
            width: '100%', height: '100%', objectFit: 'contain',
            filter: 'drop-shadow(0 0 80px var(--au-accent-glow))',
          }} />
        </div>

        {/* Beam from upper-right */}
        <div style={{
          position: 'absolute', top: '-20%', right: '-10%',
          width: '70%', height: '140%',
          background: 'conic-gradient(from 200deg at 100% 0%, transparent 0deg, oklch(0.74 0.11 75 / 0.16) 30deg, transparent 60deg)',
          filter: 'blur(24px)',
          pointerEvents: 'none',
        }} />
      </div>

      <Ambient animated={true} />

      {/* ── Top nav ── */}
      <header style={{
        position: 'relative', zIndex: 3,
        padding: '24px 40px',
      }}>
        <button
          onClick={onBack}
          className="au-back-link"
          type="button"
        >
          ← Back
        </button>
      </header>

      {/* ── Main two-column content ── */}
      <main style={{
        position: 'relative', zIndex: 3, flex: 1,
        display: 'flex', alignItems: 'center',
        padding: '0 40px 48px',
      }}>
        <div className="au-login-grid">

          {/* LEFT — heroic copy (hidden on mobile, shows above card) */}
          <div className="au-login-hero">
            <div className="au-eyebrow">Chapter I · The Long Road</div>
            <h1 className="au-title" style={{ fontSize: 'clamp(32px, 4.5vw, 52px)', lineHeight: 1.05, marginBottom: 18 }}>
              The realm<br />remembers the<br /><span style={{ color: 'var(--au-accent)' }}>disciplined.</span>
            </h1>
            <p className="au-creed" style={{ fontSize: 15, maxWidth: '40ch', marginBottom: 28 }}>
              Sign in to resume your saga — your streak, your training plan, and your guild stand ready.
            </p>
          </div>

          {/* RIGHT — floating form card */}
          <div style={{ justifySelf: 'end', width: '100%', maxWidth: 420 }}>
            {/* Card heading */}
            <div className="au-card" style={{ padding: '30px 28px 26px' }}>
              <div style={{ marginBottom: 20 }}>
                <div className="au-eyebrow" style={{ marginBottom: 6 }}>Resume Your Saga</div>
                <div style={{
                  fontFamily: 'var(--au-font-display)',
                  fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase',
                }}>
                  {cardTitle}
                </div>
              </div>

              {/* ── FORGOT PASSWORD ── */}
              {loginSubScreen === 'forgot-pw' && (
                <ForgotPasswordForm
                  forgotPwEmail={forgotPwEmail}
                  setForgotPwEmail={setForgotPwEmail}
                  authMsg={authMsg}
                  setAuthMsg={setAuthMsg}
                  authLoading={authLoading}
                  sendPasswordReset={sendPasswordReset}
                  onBack={() => { setLoginSubScreen(null); setAuthMsg(null); setForgotPwEmail(''); }}
                  onForgotUsername={() => {
                    setLoginSubScreen('forgot-username');
                    setAuthMsg(null);
                    setForgotLookupResult(null);
                    setForgotPrivateId('');
                  }}
                />
              )}

              {/* ── FORGOT USERNAME / ACCOUNT LOOKUP ── */}
              {loginSubScreen === 'forgot-username' && (
                <ForgotUsernameForm
                  forgotPrivateId={forgotPrivateId}
                  setForgotPrivateId={setForgotPrivateId}
                  forgotLookupResult={forgotLookupResult}
                  setForgotLookupResult={setForgotLookupResult}
                  authLoading={authLoading}
                  lookupByPrivateId={lookupByPrivateId}
                  onBack={() => {
                    setLoginSubScreen('forgot-pw');
                    setForgotPwEmail('');
                    setAuthMsg(null);
                    setForgotLookupResult(null);
                  }}
                />
              )}

              {/* ── MAIN LOGIN / SIGNUP FORM ── */}
              {loginSubScreen === null && (
                <MainAuthForm
                  authEmail={authEmail}
                  setAuthEmail={setAuthEmail}
                  authPassword={authPassword}
                  setAuthPassword={setAuthPassword}
                  showAuthPw={showAuthPw}
                  setShowAuthPw={setShowAuthPw}
                  authIsNew={authIsNew}
                  setAuthIsNew={setAuthIsNew}
                  authRemember={authRemember}
                  setAuthRemember={setAuthRemember}
                  authLoading={authLoading}
                  authMsg={authMsg}
                  setAuthMsg={setAuthMsg}
                  onSubmit={onSubmit}
                  onForgotPw={() => {
                    setLoginSubScreen('forgot-pw');
                    setAuthMsg(null);
                    setForgotPwEmail('');
                  }}
                />
              )}

              {/* Footer links */}
              {loginSubScreen === null && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 18, paddingTop: 16,
                  borderTop: '1px solid var(--au-hairline)',
                  fontSize: 13,
                }}>
                  {!authIsNew ? (
                    <span style={{ color: 'var(--au-text-faint)' }}>New here?</span>
                  ) : (
                    <span style={{ color: 'var(--au-text-faint)' }}>Have an account?</span>
                  )}
                  {!authIsNew ? (
                    <button
                      type="button"
                      className="au-link-btn"
                      onClick={() => { setAuthIsNew(true); setAuthMsg(null); setAuthPassword(''); }}
                    >
                      Forge a Profile →
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="au-link-btn"
                      onClick={() => { setAuthIsNew(false); setAuthMsg(null); setAuthPassword(''); }}
                    >
                      ← Sign In
                    </button>
                  )}
                </div>
              )}

              {/* Preview mode — dev PIN gate */}
              {PREVIEW_ENABLED && loginSubScreen === null && (
                <PreviewPinSection
                  previewPinEnabled={previewPinEnabled}
                  showPreviewPin={showPreviewPin}
                  setShowPreviewPin={setShowPreviewPin}
                  previewPinInput={previewPinInput}
                  setPreviewPinInput={setPreviewPinInput}
                  previewPinError={previewPinError}
                  setPreviewPinError={setPreviewPinError}
                  PREVIEW_PIN={PREVIEW_PIN}
                  launchPreviewMode={launchPreviewMode}
                />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Main auth form (login + signup) ─────────────────────────────────────────
function MainAuthForm({
  authEmail, setAuthEmail,
  authPassword, setAuthPassword,
  showAuthPw, setShowAuthPw,
  authIsNew, setAuthIsNew,
  authRemember, setAuthRemember,
  authLoading,
  authMsg, setAuthMsg,
  onSubmit,
  onForgotPw,
}) {
  const canSubmit = !authLoading && authEmail.trim() && authPassword.trim();
  const btnLabel = authLoading
    ? (authIsNew ? 'Forging your legacy…' : 'Entering the realm…')
    : (authIsNew ? 'Forge Your Legacy' : 'Enter the Realm');

  return (
    <div>
      {/* Error banner */}
      {authMsg && !authMsg.ok && (
        <div className="au-error" role="alert">
          <Glyph name="warn" size={14} />
          <span>{authMsg.text}</span>
        </div>
      )}
      {authMsg && authMsg.ok && (
        <div className="au-success" role="status">
          <Glyph name="check" size={14} />
          <span>{authMsg.text}</span>
        </div>
      )}

      {/* Email */}
      <div style={{ marginBottom: 16 }}>
        <label className="au-label" htmlFor="au-email">Email Address</label>
        <input
          id="au-email"
          type="email"
          className="au-input"
          placeholder="you@example.com"
          autoComplete="email"
          value={authEmail}
          onChange={e => { setAuthEmail(e.target.value); setAuthMsg(null); }}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
        />
      </div>

      {/* Password */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label className="au-label" htmlFor="au-pw">
            {authIsNew ? 'Create Password' : 'Password'}
          </label>
          {!authIsNew && (
            <button type="button" className="au-link-btn" style={{ fontSize: 11 }} onClick={onForgotPw}>
              Forgot?
            </button>
          )}
        </div>
        <div className="au-input-wrap">
          <input
            id="au-pw"
            type={showAuthPw ? 'text' : 'password'}
            className="au-input"
            placeholder="••••••••••••"
            autoComplete={authIsNew ? 'new-password' : 'current-password'}
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
            style={{ paddingRight: 60 }}
          />
          <button
            type="button"
            className="au-input-action"
            onClick={() => setShowAuthPw(v => !v)}
          >
            {showAuthPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Remember me */}
      <label className="au-check" style={{ marginTop: 4 }}>
        <input
          type="checkbox"
          checked={authRemember}
          onChange={e => setAuthRemember(e.target.checked)}
        />
        <span className="au-check-box" />
        <span>Remain logged in for 30 days</span>
      </label>

      {/* Primary CTA */}
      <button
        type="button"
        className="au-btn"
        style={{ marginTop: 22 }}
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {authLoading
          ? <><span className="au-spin" /> {btnLabel}</>
          : <><Glyph name={authIsNew ? 'plus' : 'sword'} size={14} /> {btnLabel}</>
        }
      </button>

      {/* OR — Passkey */}
      {!authIsNew && (
        <>
          <div className="au-or-divider"><span>or</span></div>
          <PasskeyButton disabled={authLoading} />
        </>
      )}
    </div>
  );
}

// ─── Passkey button ───────────────────────────────────────────────────────────
function PasskeyButton({ disabled }) {
  const [msg, setMsg] = useState(null);
  return (
    <div>
      <button
        type="button"
        className="au-btn-passkey"
        disabled={disabled}
        onClick={() => {
          setMsg('Passkey sign-in coming soon.');
          setTimeout(() => setMsg(null), 3000);
        }}
      >
        <Glyph name="key" size={14} /> Sign in with Passkey
      </button>
      {msg && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--au-text-faint)', marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

// ─── Forgot password sub-screen ───────────────────────────────────────────────
function ForgotPasswordForm({
  forgotPwEmail, setForgotPwEmail,
  authMsg, setAuthMsg,
  authLoading,
  sendPasswordReset,
  onBack,
  onForgotUsername,
}) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--au-text-dim)', lineHeight: 1.6, marginBottom: 18 }}>
        Enter the email address on your account and we'll send a reset link.
      </p>

      {authMsg && (
        <div className={authMsg.ok ? 'au-success' : 'au-error'} role="alert" style={{ marginBottom: 14 }}>
          <Glyph name={authMsg.ok ? 'check' : 'warn'} size={14} />
          <span>{authMsg.text}</span>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label className="au-label" htmlFor="au-forgot-email">Email Address</label>
        <input
          id="au-forgot-email"
          type="email"
          className="au-input"
          placeholder="you@example.com"
          value={forgotPwEmail}
          onChange={e => { setForgotPwEmail(e.target.value); setAuthMsg(null); }}
          onKeyDown={e => { if (e.key === 'Enter') sendPasswordReset(); }}
        />
      </div>

      <button
        type="button"
        className="au-btn"
        disabled={!forgotPwEmail.trim() || authLoading}
        onClick={sendPasswordReset}
      >
        {authLoading
          ? <><span className="au-spin" /> Sending…</>
          : 'Send Reset Link'
        }
      </button>

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 18, paddingTop: 14,
        borderTop: '1px solid var(--au-hairline)',
        fontSize: 13,
      }}>
        <button type="button" className="au-link-btn" onClick={onBack}>← Back to Sign In</button>
        <button type="button" className="au-link-btn" onClick={onForgotUsername}>Forgot your email?</button>
      </div>
    </div>
  );
}

// ─── Forgot username sub-screen ───────────────────────────────────────────────
function ForgotUsernameForm({
  forgotPrivateId, setForgotPrivateId,
  forgotLookupResult, setForgotLookupResult,
  authLoading,
  lookupByPrivateId,
  onBack,
}) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--au-text-dim)', lineHeight: 1.6, marginBottom: 18 }}>
        Enter your <strong style={{ color: 'var(--au-text)' }}>Private Account ID</strong> to look up the email on your account.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label className="au-label" htmlFor="au-private-id">Private Account ID</label>
        <input
          id="au-private-id"
          type="text"
          className="au-input"
          placeholder="e.g. xP4mRk7bN2cQ"
          value={forgotPrivateId}
          onChange={e => { setForgotPrivateId(e.target.value); setForgotLookupResult(null); }}
          onKeyDown={e => { if (e.key === 'Enter') lookupByPrivateId(); }}
          style={{ letterSpacing: '0.06em', fontFamily: 'monospace' }}
        />
      </div>

      {forgotLookupResult && (
        <div style={{
          background: forgotLookupResult.found ? 'oklch(0.62 0.16 145 / 0.08)' : 'oklch(0.62 0.16 28 / 0.08)',
          border: `1px solid ${forgotLookupResult.found ? 'oklch(0.62 0.16 145 / 0.25)' : 'oklch(0.62 0.16 28 / 0.25)'}`,
          borderRadius: 2,
          padding: '12px 14px',
          marginBottom: 14,
          textAlign: 'center',
          fontSize: 13,
        }}>
          {forgotLookupResult.found ? (
            <>
              <div style={{ color: 'oklch(0.72 0.16 145)', marginBottom: 6 }}>✓ Account found!</div>
              <div style={{ fontFamily: 'monospace', color: 'var(--au-text)', fontWeight: 700, letterSpacing: '0.04em' }}>
                {forgotLookupResult.masked_email}
              </div>
              <div style={{ color: 'var(--au-text-faint)', fontSize: 11.5, marginTop: 6 }}>
                Use this email on the password reset screen.
              </div>
              <button
                type="button"
                className="au-btn-ghost"
                style={{ marginTop: 10, fontSize: 12, padding: '8px 16px', width: 'auto' }}
                onClick={onBack}
              >
                → Go to Password Reset
              </button>
            </>
          ) : (
            <div style={{ color: 'var(--au-danger)' }}>{forgotLookupResult.error}</div>
          )}
        </div>
      )}

      {!forgotLookupResult?.found && (
        <button
          type="button"
          className="au-btn"
          disabled={!forgotPrivateId.trim() || authLoading}
          onClick={lookupByPrivateId}
        >
          {authLoading
            ? <><span className="au-spin" /> Looking up…</>
            : 'Look Up My Email'
          }
        </button>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--au-hairline)' }}>
        <button type="button" className="au-link-btn" onClick={onBack}>← Back to Password Reset</button>
      </div>
    </div>
  );
}

// ─── Preview mode PIN gate ────────────────────────────────────────────────────
function PreviewPinSection({
  previewPinEnabled, showPreviewPin,
  setShowPreviewPin, previewPinInput, setPreviewPinInput,
  previewPinError, setPreviewPinError,
  PREVIEW_PIN, launchPreviewMode,
}) {
  return (
    <div style={{
      borderTop: '1px solid var(--au-hairline)',
      marginTop: 12, paddingTop: 10, textAlign: 'center',
    }}>
      {!showPreviewPin && (
        <>
          <button
            type="button"
            className="au-link-btn"
            style={{ fontSize: 11, fontStyle: 'italic', letterSpacing: '0.03em' }}
            onClick={() => {
              if (!previewPinEnabled) {
                launchPreviewMode();
              } else {
                setShowPreviewPin(true);
                setPreviewPinInput('');
                setPreviewPinError(false);
              }
            }}
          >
            👁 Preview Mode
          </button>
          <div style={{ fontSize: 10, color: 'var(--au-text-faint)', marginTop: 2 }}>Dev access only</div>
        </>
      )}
      {showPreviewPin && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--au-text-faint)', marginBottom: 6 }}>Enter dev PIN</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            <input
              className="au-input"
              type="password"
              maxLength={8}
              value={previewPinInput}
              style={{ maxWidth: 120, textAlign: 'center', letterSpacing: '0.2em', padding: '8px 12px' }}
              onChange={e => { setPreviewPinInput(e.target.value); setPreviewPinError(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (previewPinInput === PREVIEW_PIN) launchPreviewMode();
                  else setPreviewPinError(true);
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="au-btn"
              style={{ width: 'auto', padding: '8px 14px', fontSize: 11 }}
              onClick={() => {
                if (previewPinInput === PREVIEW_PIN) launchPreviewMode();
                else setPreviewPinError(true);
              }}
            >
              Go
            </button>
          </div>
          {previewPinError && (
            <div style={{ fontSize: 11, color: 'var(--au-danger)', marginTop: 6 }}>Wrong PIN</div>
          )}
          <button
            type="button"
            className="au-link-btn"
            style={{ fontSize: 11, marginTop: 8, display: 'inline-block' }}
            onClick={() => { setShowPreviewPin(false); setPreviewPinError(false); }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
