// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Controllable get_channel_messages: each call for a channel parks a deferred
// we resolve by hand, so we can drive out-of-order resolution.
const channelDeferreds = {};
function resolveChannel(id, rows) {
  channelDeferreds[id]?.({ data: rows, error: null });
}

vi.mock('../../../utils/supabase', () => ({
  sb: {
    channel: () => ({
      on() { return this; },
      subscribe() { return this; },
    }),
    removeChannel: () => {},
    rpc: (name, args) => {
      if (name === 'get_my_conversations') return Promise.resolve({ data: [], error: null });
      if (name === 'get_total_unread_count') return Promise.resolve({ data: 0, error: null });
      if (name === 'mark_channel_read') return Promise.resolve({ data: null, error: null });
      if (name === 'get_channel_messages') {
        return new Promise(resolve => { channelDeferreds[args.p_channel_id] = resolve; });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import useMessages from '../useMessages';

const AUTH = { id: 'me' };
const conv = id => ({ channel_id: id, other_user: { player_name: id, chosen_class: 'oracle', level: 1 }, unread_count: 0 });
const row = (id, content) => ({ id, content, created_at: '2026-07-23T12:00:00.000Z', is_mine: false, sender_id: 'them', message_type: 'text' });

describe('useMessages — stale channel fetch guard (P1)', () => {
  beforeEach(() => { for (const k of Object.keys(channelDeferreds)) delete channelDeferreds[k]; });

  it('a stale fetch for a left channel never overwrites the open one', async () => {
    const { result } = renderHook(() => useMessages({ authUser: AUTH, showToast: () => {}, onOpenChat: () => {} }));

    // Open A (fetch parks), then switch to B (fetch parks) before A resolves.
    act(() => { result.current.openConversation(conv('A')); });
    await waitFor(() => expect(channelDeferreds['A']).toBeTypeOf('function'));
    act(() => { result.current.openConversation(conv('B')); });
    await waitFor(() => expect(channelDeferreds['B']).toBeTypeOf('function'));

    // Resolve B first (the current channel), then A LATE (stale).
    await act(async () => { resolveChannel('B', [row('b1', 'from B')]); });
    await act(async () => { resolveChannel('A', [row('a1', 'from A')]); });

    // A resolved last but is superseded — only B's history is shown.
    expect(result.current.msgActiveChannel.channel_id).toBe('B');
    expect(result.current.msgMessages.map(m => m.id)).toEqual(['b1']);
    expect(result.current.msgMessages.some(m => m.id === 'a1')).toBe(false);
  });
});
