import { describe, it, expect } from 'vitest';
import {
  normalizeIncomingRow,
  buildOptimisticMessage,
  mergeIncomingMessage,
  resolveOptimistic,
  failOptimistic,
  removeMessage,
  groupMessages,
  applyIncomingToConversations,
  applyLocalSendToConversations,
  clearConversationUnread,
} from '../messageUtils';

const ME = 'me-uuid';
const THEM = 'them-uuid';

const msg = (over = {}) => ({
  id: over.id ?? 'm1',
  sender_id: over.sender_id ?? THEM,
  sender_name: over.sender_name ?? 'Them',
  message_type: 'text',
  content: over.content ?? 'hello',
  edited_at: null,
  is_mine: over.sender_id === ME || over.is_mine || false,
  created_at: over.created_at ?? '2026-07-23T12:00:00.000Z',
  ...over,
});

describe('normalizeIncomingRow', () => {
  it('maps raw realtime rows to the view model', () => {
    const active = { other_user: { player_name: 'Ael' } };
    const row = { id: 'x', sender_id: THEM, content: 'hi', created_at: 'T', message_type: 'text' };
    const vm = normalizeIncomingRow(row, ME, active);
    expect(vm).toMatchObject({ id: 'x', is_mine: false, sender_name: 'Ael', content: 'hi' });
  });
  it('labels own echoes as mine', () => {
    const vm = normalizeIncomingRow({ id: 'x', sender_id: ME, content: 'hi', created_at: 'T' }, ME, null);
    expect(vm.is_mine).toBe(true);
    expect(vm.sender_name).toBe('You');
  });
});

describe('mergeIncomingMessage', () => {
  it('dedupes by id', () => {
    const list = [msg({ id: 'a' })];
    expect(mergeIncomingMessage(list, msg({ id: 'a' }))).toBe(list);
  });
  it('appends new messages sorted by created_at', () => {
    const list = [msg({ id: 'a', created_at: '2026-07-23T12:05:00Z' })];
    const out = mergeIncomingMessage(list, msg({ id: 'b', created_at: '2026-07-23T12:01:00Z' }));
    expect(out.map(m => m.id)).toEqual(['b', 'a']);
  });
  it('reconciles own echo against a pending optimistic row without duplicating', () => {
    const tmp = buildOptimisticMessage('yo', ME);
    const list = [msg({ id: 'a' }), tmp];
    const echo = msg({ id: 'real-1', sender_id: ME, is_mine: true, content: 'yo' });
    const out = mergeIncomingMessage(list, echo);
    expect(out).toHaveLength(2);
    expect(out.some(m => m.id === tmp.id)).toBe(false);
    expect(out.some(m => m.id === 'real-1')).toBe(true);
  });
  it('does not consume optimistic rows for messages from others', () => {
    const tmp = buildOptimisticMessage('yo', ME);
    const out = mergeIncomingMessage([tmp], msg({ id: 'other-1', content: 'yo' }));
    expect(out).toHaveLength(2);
  });
  it('reconciles the pending row, never a same-content failed row', () => {
    // Send "ok" (fails), then send "ok" again (pending); the echo for the
    // second send must consume the pending row and leave the failed bubble.
    const failed = { ...buildOptimisticMessage('ok', ME), pending: false, failed: true, id: 'tmp-failed' };
    const pending = { ...buildOptimisticMessage('ok', ME), id: 'tmp-pending' };
    const echo = msg({ id: 'real-2', sender_id: ME, is_mine: true, content: 'ok' });
    const out = mergeIncomingMessage([failed, pending], echo);
    expect(out.some(m => m.id === 'tmp-failed' && m.failed)).toBe(true); // failed bubble preserved
    expect(out.some(m => m.id === 'tmp-pending')).toBe(false);           // pending consumed
    expect(out.some(m => m.id === 'real-2')).toBe(true);
    expect(out).toHaveLength(2);
  });
});

describe('optimistic lifecycle', () => {
  it('resolveOptimistic swaps the tmp id for the real one and clears flags', () => {
    const tmp = buildOptimisticMessage('yo', ME);
    const out = resolveOptimistic([tmp], tmp.id, 'real-9');
    expect(out[0].id).toBe('real-9');
    expect(out[0].pending).toBeUndefined();
    expect(out[0].failed).toBeUndefined();
  });
  it('resolveOptimistic drops the tmp row when the echo already delivered the id', () => {
    // Echo (real-9) arrived first and removed the pending row; when the RPC
    // then resolves, resolving to real-9 must not create a duplicate.
    const tmp = buildOptimisticMessage('yo', ME);
    const delivered = msg({ id: 'real-9', sender_id: ME, is_mine: true, content: 'yo' });
    const out = resolveOptimistic([delivered, tmp], tmp.id, 'real-9');
    expect(out).toHaveLength(1);
    expect(out.filter(m => m.id === 'real-9')).toHaveLength(1);
  });
  it('failOptimistic marks the row failed and not pending', () => {
    const tmp = buildOptimisticMessage('yo', ME);
    const out = failOptimistic([tmp], tmp.id);
    expect(out[0].failed).toBe(true);
    expect(out[0].pending).toBeUndefined();
  });
  it('removeMessage drops the row', () => {
    const tmp = buildOptimisticMessage('yo', ME);
    expect(removeMessage([tmp], tmp.id)).toHaveLength(0);
  });
});

describe('groupMessages', () => {
  const now = new Date('2026-07-23T18:00:00Z').getTime();
  it('emits a day separator on day boundaries, Today/Yesterday labeled', () => {
    const list = [
      msg({ id: 'a', created_at: '2026-07-22T09:00:00Z' }),
      msg({ id: 'b', created_at: '2026-07-23T09:00:00Z' }),
      msg({ id: 'c', created_at: '2026-07-23T09:01:00Z' }),
    ];
    const out = groupMessages(list, now);
    expect(out[0]._daySep).toBe('Yesterday');
    expect(out[1]._daySep).toBe('Today');
    expect(out[2]._daySep).toBeNull();
  });
  it('shows the sender only at the start of a group of others’ messages', () => {
    const list = [
      msg({ id: 'a', created_at: '2026-07-23T12:00:00Z' }),
      msg({ id: 'b', created_at: '2026-07-23T12:02:00Z' }),
      msg({ id: 'c', created_at: '2026-07-23T12:10:00Z' }), // >5 min gap → new group
    ];
    const out = groupMessages(list, now);
    expect(out.map(m => m._showSender)).toEqual([true, false, true]);
  });
  it('shows the timestamp on the last message of each group', () => {
    const list = [
      msg({ id: 'a', created_at: '2026-07-23T12:00:00Z' }),
      msg({ id: 'b', created_at: '2026-07-23T12:02:00Z' }),
      msg({ id: 'c', sender_id: ME, is_mine: true, created_at: '2026-07-23T12:03:00Z' }),
    ];
    const out = groupMessages(list, now);
    expect(out.map(m => m._showTime)).toEqual([false, true, true]);
  });
  it('never shows sender labels on own messages', () => {
    const out = groupMessages([msg({ id: 'a', sender_id: ME, is_mine: true })], now);
    expect(out[0]._showSender).toBe(false);
  });
});

describe('conversation list updates', () => {
  const conv = (id, over = {}) => ({
    channel_id: id,
    unread_count: 0,
    last_message: null,
    last_activity: '2026-07-23T10:00:00Z',
    ...over,
  });
  const row = { channel_id: 'c2', sender_id: THEM, content: 'ping', created_at: '2026-07-23T12:00:00Z', message_type: 'text' };

  it('bumps unread + preview and moves the channel to the top', () => {
    const out = applyIncomingToConversations([conv('c1'), conv('c2')], row);
    expect(out[0].channel_id).toBe('c2');
    expect(out[0].unread_count).toBe(1);
    expect(out[0].last_message.content).toBe('ping');
  });
  it('returns null for unknown channels so the caller refetches', () => {
    expect(applyIncomingToConversations([conv('c1')], row)).toBeNull();
  });
  it('applyLocalSendToConversations bumps preview without touching unread', () => {
    const out = applyLocalSendToConversations([conv('c1'), conv('c2', { unread_count: 3 })], 'c2', 'sent!', ME);
    expect(out[0].channel_id).toBe('c2');
    expect(out[0].unread_count).toBe(3);
    expect(out[0].last_message).toMatchObject({ content: 'sent!', sender_id: ME });
  });
  it('clearConversationUnread zeroes only the target channel', () => {
    const out = clearConversationUnread([conv('c1', { unread_count: 2 }), conv('c2', { unread_count: 5 })], 'c2');
    expect(out.map(c => c.unread_count)).toEqual([2, 0]);
  });
});
