import { describe, it, expect } from 'vitest';
import { isTopModal, inertFlags } from '../useModalLifecycle';

/**
 * The stacking semantics behind the nested-modal Escape/inert fix, tested as
 * pure functions (the repo has no DOM test environment). Guards the two
 * regressions the primitive fixes:
 *   - one Escape closes only the frontmost layer (a ConfirmSheet over an
 *     editor closes the confirm, not both);
 *   - every covered layer is inert so focus can't reach a sheet behind a
 *     confirm.
 */
const modal = () => ({ token: {} });

describe('modal stacking — Escape topmost-only', () => {
  it('only the top-most modal handles Escape', () => {
    const editor = modal();
    const confirm = modal();
    const stack = [editor, confirm]; // confirm opened over editor
    expect(isTopModal(stack, confirm.token)).toBe(true);
    expect(isTopModal(stack, editor.token)).toBe(false); // background editor ignores Escape
  });

  it('after the top closes, the next-down becomes topmost', () => {
    const editor = modal();
    const confirm = modal();
    const stack = [editor, confirm];
    stack.pop(); // confirm dismissed
    expect(isTopModal(stack, editor.token)).toBe(true);
  });

  it('an empty stack has no topmost', () => {
    expect(isTopModal([], {})).toBe(false);
  });
});

describe('modal stacking — inert covered layers', () => {
  it('marks every modal except the top-most as inert', () => {
    const stack = [modal(), modal(), modal()];
    expect(inertFlags(stack)).toEqual([true, true, false]);
  });

  it('a single modal is never inert', () => {
    expect(inertFlags([modal()])).toEqual([false]);
  });

  it('empty stack yields no inert targets', () => {
    expect(inertFlags([])).toEqual([]);
  });
});
