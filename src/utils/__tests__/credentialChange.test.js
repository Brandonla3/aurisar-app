import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  needsCurrentPassword,
  buildPasswordUpdate,
  classifyPasswordUpdateError,
} from '../credentialChange';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

describe('a password reset must never ask for the current password', () => {
  it('exempts a recovery session', () => {
    expect(needsCurrentPassword({ isRecovery: true })).toBe(false);
  });

  it('requires it for an ordinary change', () => {
    expect(needsCurrentPassword({ isRecovery: false })).toBe(true);
  });

  it('the recovery handler sets the flag, and the form hides the field', () => {
    // If either half regresses, a user arriving from a reset link is asked
    // for the password they came to reset — the link becomes unusable.
    expect(read('src/App.jsx')).toMatch(/setPwRecoveryMode\(true\)/);
    expect(read('src/features/profile/ProfileTab.jsx')).toMatch(/\{!pwRecoveryMode && \(/);
  });

  it('never sends current_password on a recovery change', () => {
    // App.jsx passes "" for currentPassword when in recovery mode; the
    // builder must then omit the key entirely.
    const payload = buildPasswordUpdate({ password: 'NewPassw0rd!', currentPassword: '' });
    expect(payload).not.toHaveProperty('current_password');
  });
});

describe('buildPasswordUpdate omits what it does not have', () => {
  it('sends only the password when nothing else is supplied', () => {
    expect(buildPasswordUpdate({ password: 'x' })).toEqual({ password: 'x' });
  });

  it('includes current_password when present', () => {
    expect(buildPasswordUpdate({ password: 'x', currentPassword: 'old' }))
      .toEqual({ password: 'x', current_password: 'old' });
  });

  it('includes and trims the nonce', () => {
    expect(buildPasswordUpdate({ password: 'x', nonce: ' 123456 ' }))
      .toEqual({ password: 'x', nonce: '123456' });
  });

  it('drops empty/whitespace values rather than sending them', () => {
    // Sending current_password:"" when the setting is off risks a spurious
    // rejection, and nonce:"" is never meaningful.
    const p = buildPasswordUpdate({ password: 'x', currentPassword: '', nonce: '   ' });
    expect(p).toEqual({ password: 'x' });
  });

  it('carries both when both are supplied', () => {
    expect(buildPasswordUpdate({ password: 'x', currentPassword: 'old', nonce: '424242' }))
      .toEqual({ password: 'x', current_password: 'old', nonce: '424242' });
  });
});

describe('classifyPasswordUpdateError drives what the UI does next', () => {
  it('recognises a reauthentication demand by code', () => {
    expect(classifyPasswordUpdateError({ code: 'reauthentication_needed' }).kind)
      .toBe('reauth_required');
  });

  it('recognises it by message too, since codes are not guaranteed', () => {
    expect(classifyPasswordUpdateError({ message: 'A nonce is required to update the password' }).kind)
      .toBe('reauth_required');
    expect(classifyPasswordUpdateError({ message: 'Reauthentication is required' }).kind)
      .toBe('reauth_required');
  });

  it('distinguishes a bad nonce from a missing one — they need different actions', () => {
    const r = classifyPasswordUpdateError({ code: 'reauthentication_not_valid' });
    expect(r.kind).toBe('bad_nonce');
    expect(r.msg).toMatch(/send a new one/i);
  });

  it('an exact code beats any message heuristic', () => {
    // The original walked signatures once, checking code THEN patterns per
    // signature — so an earlier signature's broad message pattern (/nonce/i)
    // beat a later signature's exact code match. A real expired-nonce error
    // carries both, and was classified reauth_required: the stale nonce was
    // left in place and the user was told a fresh code had been sent.
    expect(classifyPasswordUpdateError({
      code: 'reauthentication_not_valid',
      message: 'Nonce has expired',
    }).kind).toBe('bad_nonce');
  });

  it("a signature's message pattern never overrides a DIFFERENT signature's exact code", () => {
    // The mirror of the case above, and the one that reordering alone does
    // not fix: bad_nonce's narrow pattern matches this message, but the code
    // says a nonce is being demanded, not rejected. Only checking every code
    // before any pattern gets this right — which is why the two passes exist
    // rather than just a reordered list.
    expect(classifyPasswordUpdateError({
      code: 'reauthentication_needed',
      message: 'Nonce has expired; reauthentication needed',
    }).kind).toBe('reauth_required');
  });

  it('classifies an invalid-nonce MESSAGE as bad_nonce, not reauth_required', () => {
    for (const message of ['Invalid nonce', 'Nonce has expired', 'The nonce is not valid']) {
      expect(classifyPasswordUpdateError({ message }).kind, message).toBe('bad_nonce');
    }
  });

  it('still treats a bare nonce demand as reauth_required', () => {
    // The narrower bad_nonce rule must not swallow the "you need a nonce" case.
    for (const message of ['A nonce is required to update the password', 'Reauthentication required']) {
      expect(classifyPasswordUpdateError({ message }).kind, message).toBe('reauth_required');
    }
  });

  it('recognises a wrong current password', () => {
    expect(classifyPasswordUpdateError({ message: 'Current password is incorrect' }).kind)
      .toBe('wrong_current_password');
  });

  it('recognises same-password and weak-password', () => {
    expect(classifyPasswordUpdateError({ code: 'same_password' }).kind).toBe('same_password');
    expect(classifyPasswordUpdateError({ code: 'weak_password' }).kind).toBe('weak_password');
  });

  it('returns ok for no error', () => {
    expect(classifyPasswordUpdateError(null).kind).toBe('ok');
  });

  it('an unrecognised error is never a dead end — it names the way out', () => {
    // The old code showed "Could not update password. Please try again."
    // forever. Whatever we cannot classify must still point somewhere.
    const r = classifyPasswordUpdateError({ message: 'some brand new server error' });
    expect(r.kind).toBe('unknown');
    expect(r.msg).toMatch(/email me a code/i);
  });

  it('matches codes case-insensitively', () => {
    expect(classifyPasswordUpdateError({ code: 'SAME_PASSWORD' }).kind).toBe('same_password');
  });
});

describe('the wiring that makes the two Supabase settings satisfiable', () => {
  const app = read('src/App.jsx');

  it('sends the payload the builder produced, not a bare password', () => {
    expect(app).toMatch(/updateUser\(buildPasswordUpdate\(\{/);
    expect(app).not.toMatch(/updateUser\(\{\s*password: pwNew\s*\}\)/);
  });

  it('auto-sends a code when Supabase asks for one, instead of failing generically', () => {
    expect(app).toMatch(/verdict\.kind === "reauth_required"/);
    expect(app).toMatch(/sendPasswordReauthCode\(\{ silent: true \}\)/);
  });

  it('clears a rejected nonce so the stale one is not resubmitted', () => {
    expect(app).toMatch(/verdict\.kind === "bad_nonce"\) setPwNonce\(""\)/);
  });

  it('offers the code path unconditionally in the UI', () => {
    // Not only after a detected failure — the error strings come from a
    // server this app does not control.
    const tab = read('src/features/profile/ProfileTab.jsx');
    expect(tab).toMatch(/onClick=\{\(\) => sendPasswordReauthCode\(\)\}/);
    expect(tab).toMatch(/Email me a code/);
  });

  it('does not claim a code was emailed when sending it failed', () => {
    // sendPasswordReauthCode sets the real reason on failure; overwriting it
    // with "we've emailed you a code" promises an email that never went, and
    // points at a field that stays hidden because pwReauthSent is still false.
    const branch = app.slice(
      app.indexOf('verdict.kind === "reauth_required"'),
      app.indexOf('if (verdict.kind === "bad_nonce")')
    );
    expect(branch).toMatch(/const sent = await sendPasswordReauthCode/);
    expect(branch).toMatch(/if \(!sent\) \{[\s\S]*?return;/);
  });

  it('the recovery exemption cannot outlive its session', () => {
    // Set on PASSWORD_RECOVERY and previously cleared only on a SUCCESSFUL
    // change, so signing out and logging in normally in the same SPA session
    // still hid the current-password field and omitted current_password.
    const signedOut = app.slice(app.indexOf('_event === "SIGNED_OUT"'), app.indexOf('_event === "SIGNED_OUT"') + 1200);
    expect(signedOut).toContain('setPwRecoveryMode(false)');
    // And again at the unambiguous fresh-login point, independent of the
    // order auth events happen to arrive in.
    const signInIdx = app.indexOf('signInWithPassword');
    expect(signInIdx).toBeGreaterThan(-1);
    expect(app.slice(Math.max(0, signInIdx - 400), signInIdx))
      .toContain('setPwRecoveryMode(false)');
  });

  it('clears the proof fields once the change succeeds', () => {
    const success = app.slice(app.indexOf('✓ Password updated!'));
    for (const setter of ['setPwCurrent("")', 'setPwNonce("")', 'setPwRecoveryMode(false)']) {
      expect(success).toContain(setter);
    }
  });
});
