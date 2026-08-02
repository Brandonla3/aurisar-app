import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderNotificationEmail, fromAddressFor } from '../_lib/notificationEmails.js';
import { renderEmail, cardBody, escapeHtml } from '../_lib/emailTemplate.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

describe('emailTemplate', () => {
  it('escapes every HTML special character', () => {
    expect(escapeHtml(`<script>&"'/`)).toBe('&lt;script&gt;&amp;&quot;&#39;&#x2F;');
  });

  it('escapes the title and footer it interpolates', () => {
    const html = renderEmail({
      title: '<evil>', bodyHtml: '<p>ok</p>', footerNote: '<bad>',
    });
    expect(html).toContain('&lt;evil&gt;');
    expect(html).toContain('&lt;bad&gt;');
    expect(html).not.toContain('<evil>');
  });

  it('renders a CTA only when both text and url are supplied', () => {
    const withCta = renderEmail({ title: 't', bodyHtml: '', footerNote: 'f', ctaText: 'Go', ctaUrl: 'https://x.test' });
    expect(withCta).toContain('https://x.test');
    const without = renderEmail({ title: 't', bodyHtml: '', footerNote: 'f', ctaText: 'Go' });
    expect(without).not.toContain('<a href');
  });

  it('cardBody renders one paragraph per entry', () => {
    const body = cardBody('Head', ['one', 'two']);
    expect(body).toContain('Head');
    expect((body.match(/<p /g) || []).length).toBe(2);
  });
});

describe('renderNotificationEmail', () => {
  it('renders each event type the drain can send', () => {
    const cases = [
      ['friend_level_up', { playerName: 'Ayo', newLevel: 12 }],
      ['friend_request', { fromName: 'Ayo' }],
      ['friend_accepted', { friendName: 'Ayo' }],
      ['shared_workout', { fromName: 'Ayo', workoutName: 'Leg Day' }],
      ['message_received', { fromName: 'Ayo' }],
      ['streak_at_risk', { streak: 9 }],
      ['workout_reminder', {}],
      ['welcome', {}],
      ['security_alert', { text: 'MFA removed' }],
    ];
    for (const [event_type, payload] of cases) {
      const out = renderNotificationEmail({ event_type, payload });
      expect(out, `${event_type} must render`).toBeTruthy();
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('AURISAR');
    }
  });

  it('returns null for in-app-only events so the drain marks them skipped', () => {
    expect(renderNotificationEmail({ event_type: 'review_battle_stats', payload: {} })).toBeNull();
    expect(renderNotificationEmail({ event_type: 'friend_exercise', payload: {} })).toBeNull();
  });

  it('escapes attacker-controlled display names', () => {
    const out = renderNotificationEmail({
      event_type: 'friend_request',
      payload: { fromName: '<img src=x onerror=alert(1)>' },
    });
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img');
  });

  it('never puts message contents in the message_received email', () => {
    const out = renderNotificationEmail({
      event_type: 'message_received',
      payload: { fromName: 'Ayo', content: 'SECRET-BODY-TEXT' },
    });
    expect(out.html).not.toContain('SECRET-BODY-TEXT');
  });

  it('tolerates a missing payload without throwing', () => {
    expect(() => renderNotificationEmail({ event_type: 'friend_level_up', payload: {} })).not.toThrow();
  });
});

describe('welcome email has exactly one sender', () => {
  const app = read('src/App.jsx');

  it('the client never calls a welcome endpoint — the outbox trigger owns it', () => {
    // Both paths firing sent two emails from two addresses whenever Supabase
    // email-confirmation was off.
    expect(app).not.toContain('fetch("/api/send-welcome-email"');
    expect(app).not.toContain("fetch('/api/send-welcome-email'");
  });

  it('welcome mail keeps the welcome@ identity; everything else uses notifications@', () => {
    expect(fromAddressFor('welcome')).toContain('welcome@aurisargames.com');
    expect(fromAddressFor('friend_level_up')).toContain('notifications@aurisargames.com');
    expect(fromAddressFor('some_future_event')).toContain('notifications@aurisargames.com');
  });
});

describe('drain delivery semantics (source guard)', () => {
  const drain = read('netlify/functions/notifications-drain.js');

  it('picks the sender per event type', () => {
    expect(drain).toContain('fromAddressFor(row.event_type)');
  });

  it('claims rows atomically rather than plain-selecting them', () => {
    expect(drain).toContain('claim_notification_emails');
  });

  it('sends a stable per-row idempotency key', () => {
    expect(drain).toContain('Idempotency-Key');
    expect(drain).toContain('`notification/${row.id}`');
  });

  it('requeues on 5xx/429 and dead-letters only on 4xx', () => {
    expect(drain).toContain('res.status >= 500 || res.status === 429');
    expect(drain).toContain("email_status: \"failed\"");
  });

  it('refuses to run without its env', () => {
    expect(drain).toContain('refusing to run');
  });
});

describe('should_deliver checkpoint (source guard)', () => {
  const mig = read('scripts/security/17-notifications.sql');
  const fn = mig.slice(
    mig.indexOf('CREATE OR REPLACE FUNCTION public.should_deliver('),
    mig.indexOf('CREATE OR REPLACE FUNCTION public.should_deliver_email')
  );

  it('suppression is permanent but unverified email only defers', () => {
    expect(fn).toContain('notification_suppressions');
    const suppressIdx = fn.indexOf('notification_suppressions');
    const confirmIdx = fn.indexOf('v_confirmed_at IS NULL');
    expect(fn.slice(suppressIdx, suppressIdx + 200)).toContain("RETURN 'skip'");
    expect(fn.slice(confirmIdx, confirmIdx + 120)).toContain("RETURN 'defer'");
  });

  it('security and welcome mail cannot be opted out of', () => {
    expect(fn).toContain("p_event_type IN ('welcome', 'security_alert')");
  });

  it('quiet hours exempt transactional mail', () => {
    expect(fn).toContain("p_event_type NOT IN ('welcome', 'security_alert')");
  });

  it('falls back to the shared defaults matrix when no pref row exists', () => {
    expect(fn).toContain('COALESCE(v_enabled, public.default_notification_pref');
  });
});
