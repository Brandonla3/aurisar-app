/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import NotificationInbox from '../NotificationInbox';
import { ok, empty, unavailable, loading } from '../../../utils/fetchResult';

afterEach(cleanup);

const renderInbox = (state, items = []) =>
  render(
    <NotificationInbox
      open
      onClose={() => {}}
      items={items}
      unreadCount={0}
      onMarkAllRead={() => {}}
      state={state}
    />
  );

describe('the inbox draws three distinct states', () => {
  it('a PROVEN-empty inbox reassures and does not alarm', () => {
    renderInbox(empty());
    expect(screen.getByText(/No alerts yet/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a STRUCTURALLY BROKEN inbox says so loudly and names the fault', () => {
    // This is the case that used to be pixel-identical to "no alerts yet",
    // which is how a permanently dead inbox could look perfectly healthy.
    renderInbox(unavailable({ code: '42P01', message: 'relation does not exist' },
      { surface: 'notifications.inbox' }));

    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(screen.getByText(/aren.t working/i)).toBeTruthy();
    // Explicitly tells the user this is NOT an empty inbox.
    expect(screen.getByText(/isn.t an empty inbox/i)).toBeTruthy();
    // And carries enough for a developer to act on.
    expect(alert.textContent).toContain('42P01');
    expect(alert.textContent).toContain('notifications.inbox');
    // Must NOT show the serene copy.
    expect(screen.queryByText(/No alerts yet/i)).toBeNull();
  });

  it('a TRANSIENT failure stays calm — a train tunnel is not an outage', () => {
    renderInbox(unavailable({ message: 'TypeError: Failed to fetch' }));
    expect(screen.getByText(/Can.t reach the server/i)).toBeTruthy();
    // No alarm, and crucially no claim that the feature is broken.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/aren.t working/i)).toBeNull();
  });

  it('renders real rows when there are any', () => {
    const rows = [{
      id: 1, event_type: 'friend_request', payload: { fromName: 'Ayo' },
      created_at: new Date().toISOString(), read_at: null,
    }];
    renderInbox(ok(rows), rows);
    expect(screen.getByText(/sent you a friend request/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an empty state carries provenance, so "checked when?" is answerable', () => {
    renderInbox(empty());
    expect(screen.getByText(/^Checked /)).toBeTruthy();
  });

  it('does NOT claim "nothing here" before the first read settles', () => {
    // Initialising to empty() would assert a proven-empty result for a query
    // that has not run — the same lie as an error rendering as empty.
    renderInbox(loading());
    expect(screen.getByText(/Checking for alerts/i)).toBeTruthy();
    expect(screen.queryByText(/No alerts yet/i)).toBeNull();
    expect(screen.queryByText(/^Checked /)).toBeNull();
  });
});

describe('a failed refresh keeps previously-loaded rows visible', () => {
  const rows = [{
    id: 7, event_type: 'friend_accepted', payload: { friendName: 'Ayo' },
    created_at: new Date().toISOString(), read_at: null,
  }];

  it('renders the broken banner ABOVE the stale list, not instead of it', () => {
    // The banner used to short-circuit the list, so a failing refresh blanked
    // the screen — contradicting the hook's deliberate decision to keep items.
    renderInbox(unavailable({ code: '42P01', message: 'x' }, { surface: 'notifications.inbox' }), rows);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/accepted your friend request/i)).toBeTruthy();
    expect(screen.getByText(/loaded earlier and may be out of date/i)).toBeTruthy();
  });

  it('renders the transient notice above the stale list too', () => {
    renderInbox(unavailable({ message: 'Failed to fetch' }), rows);
    expect(screen.getByText(/Can.t reach the server/i)).toBeTruthy();
    expect(screen.getByText(/accepted your friend request/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the hook only classifies calls it is entitled to make', () => {
  it('gates reads on an active session, so a signed-out 42501 is never shown as broken', async () => {
    // Verified against the live database: an anon read of `notifications`
    // returns 42501 (migration 17 revoked anon), which the classifier rightly
    // calls permanent. Rendering that as "broken" would be a false alarm, so
    // the hook must not read at all without a session.
    // NB: this file runs under jsdom, where import.meta.url is not a file://
    // URL, so fileURLToPath (used by the repo's other source guards) throws.
    // vitest runs from the repo root, so a cwd-relative path is portable here.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/features/notifications/useNotifications.js', 'utf8');
    expect(src).toMatch(/const active\s*=\s*!!userId\s*&&\s*!isPreviewMode/);
    expect(src).toMatch(/if \(!active\) return;/);
  });
});
