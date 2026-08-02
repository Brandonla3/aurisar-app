import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldChallengeMfa } from '../mfaGate';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

describe('shouldChallengeMfa', () => {
  const AAL1_PENDING = { currentLevel: 'aal1', nextLevel: 'aal2' };
  const verified = { totp: [{ id: 'f1', status: 'verified' }] };

  it('challenges an aal1 session that has a verified factor (the reload bypass)', () => {
    expect(shouldChallengeMfa(AAL1_PENDING, verified))
      .toEqual({ challenge: true, factorId: 'f1', factorType: 'totp' });
  });

  it('does not challenge a session that already satisfied MFA', () => {
    expect(shouldChallengeMfa({ currentLevel: 'aal2', nextLevel: 'aal2' }, verified).challenge)
      .toBe(false);
  });

  it('does not challenge a user who never enrolled', () => {
    expect(shouldChallengeMfa({ currentLevel: 'aal1', nextLevel: 'aal1' }, { totp: [] }).challenge)
      .toBe(false);
  });

  it('does not challenge when the only factor is unverified', () => {
    const unverified = { totp: [{ id: 'f2', status: 'unverified' }] };
    expect(shouldChallengeMfa(AAL1_PENDING, unverified).challenge).toBe(false);
  });

  it('fails open on missing data rather than locking the user out', () => {
    expect(shouldChallengeMfa(null, null).challenge).toBe(false);
    expect(shouldChallengeMfa(AAL1_PENDING, null).challenge).toBe(false);
  });

  // Supabase derives AAL from ANY verified factor. Only inspecting `totp` let a
  // passkey-only user past the gate at aal1 and straight into the aal2 RLS
  // wall, which presents as a hard lockout rather than a prompt.
  it('challenges a passkey-only account', () => {
    const passkeyOnly = { webauthn: [{ id: 'w1', status: 'verified' }] };
    expect(shouldChallengeMfa(AAL1_PENDING, passkeyOnly))
      .toEqual({ challenge: true, factorId: 'w1', factorType: 'webauthn' });
  });

  it('challenges a phone-only account', () => {
    const phoneOnly = { phone: [{ id: 'p1', status: 'verified' }] };
    expect(shouldChallengeMfa(AAL1_PENDING, phoneOnly))
      .toEqual({ challenge: true, factorId: 'p1', factorType: 'phone' });
  });

  it('prefers TOTP when several factor types are enrolled — the code screen can satisfy it', () => {
    const mixed = {
      webauthn: [{ id: 'w1', status: 'verified' }],
      totp: [{ id: 't1', status: 'verified' }],
    };
    expect(shouldChallengeMfa(AAL1_PENDING, mixed))
      .toEqual({ challenge: true, factorId: 't1', factorType: 'totp' });
  });

  it('ignores unverified factors across every bucket', () => {
    const none = {
      totp: [{ id: 't1', status: 'unverified' }],
      webauthn: [{ id: 'w1', status: 'unverified' }],
      phone: [{ id: 'p1', status: 'unverified' }],
    };
    expect(shouldChallengeMfa(AAL1_PENDING, none).challenge).toBe(false);
  });
});

describe('the gate is wired into every entry path (source guard)', () => {
  const app = read('src/App.jsx');

  it('runs on the getSession bootstrap path — the refresh-bypass fix', () => {
    // The bootstrap handler previously called only checkMfaStatus() (display
    // state) and fell through to setScreen("main").
    const body = app.slice(app.indexOf('sb.auth.getSession().then(async'));
    const handler = body.slice(0, body.indexOf('.catch(() => setScreen("login"))'));
    expect(handler).toContain('await checkAndHandleMfaChallenge()');
    expect(handler.indexOf('await checkAndHandleMfaChallenge()'))
      .toBeLessThan(handler.indexOf('setScreen("main")'));
  });

  it('runs on the onAuthStateChange signed-in path (covers passkeys)', () => {
    const body = app.slice(app.indexOf('// Sign-in (or any other auth event with a real user)'));
    const handler = body.slice(0, body.indexOf('// Check existing session on mount'));
    expect(handler).toContain('await checkAndHandleMfaChallenge()');
    expect(handler.indexOf('await checkAndHandleMfaChallenge()'))
      .toBeLessThan(handler.indexOf('loadAdminFlags'));
  });

  it('still runs on the password sign-in path', () => {
    expect(app).toContain('await checkAndHandleMfaChallenge()');
    // four call sites: bootstrap, auth-state-change, password, PASSWORD_RECOVERY
    expect(app.match(/await checkAndHandleMfaChallenge\(\)/g).length).toBeGreaterThanOrEqual(4);
  });

  it('runs on the PASSWORD_RECOVERY path — a reset link is not an MFA bypass', () => {
    const body = app.slice(app.indexOf('if (_event === "PASSWORD_RECOVERY")'));
    const handler = body.slice(0, body.indexOf('// Silent background events'));
    expect(handler).toContain('await checkAndHandleMfaChallenge()');
    expect(handler.indexOf('await checkAndHandleMfaChallenge()'))
      .toBeLessThan(handler.indexOf('setScreen("main")'));
  });

  it('clears challenge state on SIGNED_OUT so a dead session cannot strand the user', () => {
    const body = app.slice(app.indexOf('if (_event === "SIGNED_OUT")'));
    const handler = body.slice(0, body.indexOf('return;'));
    expect(handler).toContain('setMfaChallengeScreen(false)');
  });

  it('renders the challenge ahead of the loading screen', () => {
    // The bootstrap gate returns early while screen is still "loading"; if the
    // loading branch won, an MFA user would be stranded on it forever.
    expect(app).toContain('if (screen === "loading" && !mfaChallengeScreen)');
  });
});

describe('recovery escape hatch (source guard)', () => {
  const mig = read('scripts/security/18-mfa-recovery-fix-and-aal2.sql');
  // The migration's prose explains the old auth.mfa_unenroll bug, so assertions
  // about executable SQL must ignore `--` comment lines.
  const stripSqlComments = s =>
    s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  it('use_mfa_recovery_code no longer calls the nonexistent auth.mfa_unenroll', () => {
    const fn = stripSqlComments(mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.use_mfa_recovery_code'),
      mig.indexOf('CREATE OR REPLACE FUNCTION public.disable_mfa_verified')
    ));
    expect(fn).not.toContain('mfa_unenroll');
    expect(fn).toContain('DELETE FROM auth.mfa_factors');
  });

  it('disable_mfa_verified schema-qualifies mfa_recovery_codes under search_path=""', () => {
    const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.disable_mfa_verified'));
    const body = fn.slice(0, fn.indexOf('$$;') + 3);
    expect(body).toContain('public.mfa_recovery_codes');
  });

  it('the aal2 predicate lets a recovered (factor-less) user through', () => {
    const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.has_required_aal'));
    const body = fn.slice(0, fn.indexOf('$$;') + 3);
    expect(body).toContain("= 'aal2'");
    expect(body).toContain('NOT EXISTS');
    expect(body).toContain("f.status = 'verified'");
  });
});
