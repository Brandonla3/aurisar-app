import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The db-contract checker is a guard; a guard that silently stops guarding is
 * worse than none. These lock in the properties that make it useful, and the
 * inventory it produced — notably that several security-relevant RPCs are
 * declared in no tracked SQL file.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');
const contract = JSON.parse(read('config/db-contract.json'));

describe('db-contract artifact', () => {
  it('captures the tables and RPCs the notification spine needs', () => {
    // These come from migrations 17-20. If the extractor ever stops seeing
    // them, the guard has gone blind to the exact class of bug it exists for.
    for (const t of ['notifications', 'notification_prefs', 'notification_suppressions']) {
      expect(contract.tables, t).toContain(t);
    }
    for (const f of ['claim_notification_emails', 'should_deliver_email', 'check_invite_token']) {
      expect(contract.functions, f).toContain(f);
    }
  });

  it('resolves the drain\'s dynamic rpc() helper via its marker', () => {
    // notifications-drain.js builds the URL as `rest/v1/rpc/${fn}`; without the
    // `// db-contract: dynamic(...)` marker these are invisible to any static
    // scan, and the extractor is written to fail rather than skip them.
    expect(contract.functions).toContain('claim_notification_emails');
    expect(read('netlify/functions/notifications-drain.js')).toMatch(
      /db-contract:\s*dynamic\([^)]*claim_notification_emails/
    );
  });

  it('the once-untracked security RPCs are now declared, and stay that way', () => {
    // These spent months live-but-untracked (carried in knownUndeclared with
    // reasons demanding a migration). Migration 26 is that migration; the
    // ratchet must never accept them as undeclared again.
    for (const fn of ['lookup_email_by_private_id', 'send_phone_otp', 'verify_phone_otp']) {
      expect(contract.functions, fn).toContain(fn);
      expect(contract.knownUndeclared, fn).not.toHaveProperty(`function:${fn}`);
    }
    // declaredTables, not tables: only the SECURITY DEFINER functions touch
    // this table — no client code references it, and none should.
    expect(contract.declaredTables).toContain('phone_verification_codes');
  });

  it('every accepted-undeclared entry carries a reason', () => {
    for (const [key, entry] of Object.entries(contract.knownUndeclared)) {
      expect(entry.reason, key).toBeTruthy();
      expect(entry.reason.length, key).toBeGreaterThan(20);
    }
  });

  it('does not mistake Array.from / Buffer.from for a Supabase table', () => {
    // The scan anchors on the `sb`/`supabase` receivers. Without that, this
    // tree's ~15 Array.from/Buffer.from calls would land in `tables`.
    for (const bogus of ['length', 'expected', 'keys', 'secret', 'sig', 'token']) {
      expect(contract.tables, bogus).not.toContain(bogus);
    }
  });
});

describe('scanner covers this repo\'s actual call styles', () => {
  it('sees multiline `await sb\\n  .from(...)` — the dominant style here', () => {
    // A line-local scan missed EVERY multiline site, including these two, while
    // reporting success. The negative test that "proved" the guard worked only
    // covered same-line calls.
    expect(contract.tables).toContain('exercises');   // src/utils/exerciseLibrary.js
    expect(contract.tables).toContain('invites');     // netlify/functions/admin-send-invite.js
    expect(contract.tables).toContain('notification_prefs');
  });

  it('sees RPCs that pass arguments, not just bare-name calls', () => {
    // `sb.rpc('fn', { args })` must count; requiring a closing paren right
    // after the name treated every argument-passing RPC as a dynamic site.
    for (const fn of ['get_leaderboard', 'send_message', 'get_channel_messages']) {
      expect(contract.functions, fn).toContain(fn);
    }
  });

  it('is not limited to a hardcoded list of client variable names', () => {
    // adminAuth.js uses `supa`, not `sb`/`supabase`. Anchoring on a fixed list
    // silently dropped whatever a new alias touched.
    const src = read('scripts/check_db_contract.mjs');
    expect(src).toContain('NOT_CLIENTS');
    expect(src).toMatch(/Array/);
    expect(src).toMatch(/Buffer/);
  });
});

describe('the ratchet cannot be laundered', () => {
  const src = read('scripts/check_db_contract.mjs');

  it('emit only seeds the baseline on first bootstrap or with --seed-baseline', () => {
    // The original emit auto-added ANY undeclared object with a generic
    // "BASELINE" reason. CI said "run emit"; emit absolved the object; the next
    // run passed. The documented ratchet was a no-op.
    expect(src).toContain('firstBootstrap');
    expect(src).toContain('--seed-baseline');
    expect(src).toMatch(/if\s*\(firstBootstrap\s*\|\|\s*SEED\)/);
  });

  it('emit itself fails on a new undeclared object', () => {
    expect(src).toContain('Re-running emit will NOT absolve them');
  });

  it('applies CREATE and DROP in positional order', () => {
    // Two passes (all CREATEs, then all DROPs) breaks the standard
    // `DROP IF EXISTS x; CREATE x;` idiom used throughout scripts/security.
    expect(src).toContain('events.sort');
  });

  it('requires a dynamic marker to actually name something', () => {
    expect(src).toContain('marker names no objects');
  });
});

describe('db-contract checker is wired to run', () => {
  it('is a CI step and an npm script, matching the other *:check guards', () => {
    expect(read('package.json')).toContain('emit:db-contract:check');
    expect(read('.github/workflows/ci.yml')).toContain('npm run emit:db-contract:check');
  });

  it('needs no database credentials, so it runs on forked PRs', () => {
    const src = read('scripts/check_db_contract.mjs');
    for (const secret of ['SERVICE_ROLE', 'SUPABASE_URL', 'fetch(']) {
      expect(src, `checker must stay offline (${secret})`).not.toContain(secret);
    }
  });
});
