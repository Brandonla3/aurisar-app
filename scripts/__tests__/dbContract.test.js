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

  it('records the untracked security-relevant RPCs rather than hiding them', () => {
    // Each of these is reachable from the app but declared in no tracked file,
    // so its grants and rate limiting cannot be reviewed from the repo.
    for (const key of [
      'function:lookup_email_by_private_id',
      'function:send_phone_otp',
      'function:verify_phone_otp',
    ]) {
      expect(contract.knownUndeclared, key).toHaveProperty(key);
      expect(contract.knownUndeclared[key].reason).toMatch(/UNTRACKED, SECURITY-RELEVANT/);
    }
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
