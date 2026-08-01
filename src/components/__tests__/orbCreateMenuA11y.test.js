import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PR #294 review: the orb's Create popover had no focus management at all —
 * opening it left focus on the trigger button, the disabled "Repeat Last"
 * row was only opacity-dimmed (a real `disabled` button, focusable and
 * clickable, is what a screen reader/keyboard user actually gets), nothing
 * closed it on navigation, and nothing restored focus on dismissal. Source
 * guard because the component renders via createPortal and pulls in enough
 * of the app's data/style modules that a jsdom render isn't worth the
 * fragility here — matches the repo's existing pattern (builderReset.test.js,
 * repeatLastReplaceGuard.test.js) for wiring that isn't otherwise testable.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'src/components/OrbCreateMenu.jsx', 'utf8');

describe('OrbCreateMenu accessibility wiring', () => {
  it('moves focus into the surface on open (first row, or the search input in pick view)', () => {
    expect(src).toContain('firstRowRef.current?.focus()');
    expect(src).toContain('searchRef.current?.focus()');
  });

  it('the disabled Repeat Last row is a real disabled control, not opacity-only', () => {
    const body = src.slice(src.indexOf('actions.map((a, i)'), src.indexOf('{view === "pick" &&'));
    expect(body).toContain('disabled={a.disabled}');
    expect(body).toContain('aria-disabled={a.disabled}');
  });

  it('closes when the active tab changes underneath it', () => {
    expect(src).toContain('activeTabRef.current !== activeTab');
    expect(src).toMatch(/if \(open && activeTabRef\.current !== activeTab\) onClose\(\)/);
  });

  it('restores focus to whatever triggered it (the orb toggle) on dismissal', () => {
    const body = src.slice(src.indexOf('returnFocusRef = React.useRef'));
    expect(body).toContain('returnFocusRef.current = document.activeElement');
    expect(body).toContain('returnFocusRef.current.focus()');
    // Must guard against a detached/removed element before refocusing it.
    expect(body).toMatch(/document\.body\.contains\(returnFocusRef\.current\)/);
  });
});
