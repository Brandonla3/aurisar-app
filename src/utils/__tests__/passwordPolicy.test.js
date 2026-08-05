import { describe, it, expect, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  validatePasswordPolicy,
  isPasswordBreached,
  passwordCharClassesPresent,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../passwordPolicy';

// Node exposes SubtleCrypto under webcrypto; the browser has it on globalThis.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

afterEach(() => vi.unstubAllGlobals());

// SHA-1("Password1!") — the prefix/suffix split HIBP's k-anonymity API uses.
const KNOWN = 'Password1!';
const hibpResponding = (suffixesFn) =>
  vi.fn(async () => ({ ok: true, text: async () => suffixesFn() }));

async function suffixOf(pw) {
  const buf = new TextEncoder().encode(pw);
  const hash = await globalThis.crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().slice(5);
}

describe('isPasswordBreached is a tri-state, not a boolean', () => {
  it('reports "breached" when HIBP lists the suffix', async () => {
    const suffix = await suffixOf(KNOWN);
    vi.stubGlobal('fetch', hibpResponding(() => `${suffix}:42\nAAAA:1`));
    await expect(isPasswordBreached(KNOWN)).resolves.toBe('breached');
  });

  it('reports "clean" when HIBP answers and the suffix is absent', async () => {
    vi.stubGlobal('fetch', hibpResponding(() => '0000000000000000000000000000000000A:3'));
    await expect(isPasswordBreached(KNOWN)).resolves.toBe('clean');
  });

  it('reports "unknown" — NOT clean — when HIBP is unreachable', async () => {
    // The original returned false here, making an outage indistinguishable
    // from a clean password. That silently accepted breached credentials.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(isPasswordBreached(KNOWN)).resolves.toBe('unknown');
  });

  it('reports "unknown" on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(isPasswordBreached(KNOWN)).resolves.toBe('unknown');
  });

  it('retries once, so a single blip does not block a signup', async () => {
    const suffix = await suffixOf(KNOWN);
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('blip');
      return { ok: true, text: async () => `${suffix}:9` };
    }));
    await expect(isPasswordBreached(KNOWN)).resolves.toBe('breached');
    expect(calls).toBe(2);
  });

  it('gives up after the retry rather than hanging on a real outage', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; throw new Error('down'); }));
    await expect(isPasswordBreached(KNOWN)).resolves.toBe('unknown');
    expect(calls).toBe(2);
  });

  it('sends only the 5-char prefix — the full hash never leaves the browser', async () => {
    let requested;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      requested = String(url);
      return { ok: true, text: async () => '' };
    }));
    await isPasswordBreached(KNOWN);
    const sent = requested.split('/range/')[1];
    expect(sent).toHaveLength(5);
    const fullSuffix = await suffixOf(KNOWN);
    expect(requested).not.toContain(fullSuffix);
  });
});

describe('validatePasswordPolicy fails CLOSED when it cannot check', () => {
  it('rejects, and says it could not check — never claims a breach it did not see', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const r = await validatePasswordPolicy('Str0ng&Passw0rd');
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/couldn'?t check/i);
    expect(r.msg).not.toMatch(/data breach/i);
  });

  it('accepts a strong password when HIBP confirms it is clean', async () => {
    vi.stubGlobal('fetch', hibpResponding(() => 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1'));
    await expect(validatePasswordPolicy('Str0ng&Passw0rd')).resolves.toEqual({ ok: true });
  });

  it('names the breach explicitly when there really is one', async () => {
    const suffix = await suffixOf('Str0ng&Passw0rd');
    vi.stubGlobal('fetch', hibpResponding(() => `${suffix}:1200`));
    const r = await validatePasswordPolicy('Str0ng&Passw0rd');
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/data breach/i);
  });
});

describe('composition rules are checked before any network call', () => {
  it('rejects a short password without contacting HIBP', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await validatePasswordPolicy('Ab1!');
    expect(r.ok).toBe(false);
    expect(r.msg).toContain(String(PASSWORD_MIN_LENGTH));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a password over the bcrypt limit', async () => {
    const r = await validatePasswordPolicy('Aa1!' + 'x'.repeat(PASSWORD_MAX_LENGTH));
    expect(r.ok).toBe(false);
    expect(r.msg).toContain(String(PASSWORD_MAX_LENGTH));
  });

  it('requires 3 of 4 character classes', async () => {
    const r = await validatePasswordPolicy('alllowercaseonly');
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/at least 3 of/i);
  });

  it('counts classes the way the message describes', () => {
    expect(passwordCharClassesPresent('abcdefgh')).toBe(1);
    expect(passwordCharClassesPresent('abcDEFgh')).toBe(2);
    expect(passwordCharClassesPresent('abcDEF12')).toBe(3);
    expect(passwordCharClassesPresent('abcDEF1!')).toBe(4);
  });

  it('accepts 3-of-4 without a digit — the combination a stricter server rule would reject', async () => {
    // Documents the mismatch risk if Supabase's "required characters" is ever
    // switched on: this password is valid here and would fail a digits rule.
    const noDigit = 'PasswordLess&Long';
    expect(/[0-9]/.test(noDigit), 'must genuinely contain no digit').toBe(false);
    expect(passwordCharClassesPresent(noDigit)).toBe(3);
    vi.stubGlobal('fetch', hibpResponding(() => 'FFFF:1'));
    await expect(validatePasswordPolicy(noDigit)).resolves.toEqual({ ok: true });
  });
});
