import { useEffect, useRef, useState } from 'react';
import { sb } from '../../utils/supabase';
import {
  normalizeIncomingRow,
  buildOptimisticMessage,
  mergeIncomingMessage,
  mergeSnapshot,
  resolveOptimistic,
  failOptimistic,
  removeMessage,
  applyIncomingToConversations,
  applyLocalSendToConversations,
  clearConversationUnread,
} from './messageUtils';

/**
 * All Messages-tab state and actions, extracted from App.jsx (the fifth
 * slice of the App decomposition — MessagesTab itself was the fourth).
 *
 * Replaces the old refetch-everything realtime handler with a targeted one:
 * incoming INSERTs are merged into local state (deduped against optimistic
 * rows) and a debounced background reconcile keeps the server as the source
 * of truth. Sends are optimistic — the bubble appears instantly and is
 * confirmed by the uuid send_message returns, or marked failed with retry.
 */
export default function useMessages({ authUser, showToast, onOpenChat }) {
  const [msgView, setMsgView] = useState("list"); // "list" | "chat"
  const [msgConversations, setMsgConversations] = useState([]);
  const [msgActiveChannel, setMsgActiveChannel] = useState(null);
  const [msgMessages, setMsgMessages] = useState([]);
  const [msgInput, setMsgInput] = useState("");
  const [msgLoading, setMsgLoading] = useState(false); // open-chat window
  const [msgListLoading, setMsgListLoading] = useState(false); // first conversations fetch
  const [msgListError, setMsgListError] = useState(null);
  const [msgChatError, setMsgChatError] = useState(null);
  const [msgUnreadTotal, setMsgUnreadTotal] = useState(0);

  // "Latest value" refs so the single realtime subscription never holds
  // stale closures — kept current by the passive effect below.
  const authUserRef = useRef(null);
  const activeChannelRef = useRef(null);
  const showToastRef = useRef(null);
  const handleIncomingRef = useRef(null);
  const listLoadedRef = useRef(false);
  // Monotonic token so an out-of-order channel fetch can't overwrite a newer one.
  const loadSeqRef = useRef(0);

  async function loadConversations() {
    if (!authUserRef.current) return;
    if (!listLoadedRef.current) setMsgListLoading(true);
    try {
      const { data, error } = await sb.rpc('get_my_conversations');
      if (error) throw error;
      listLoadedRef.current = true;
      setMsgConversations(data || []);
      setMsgListError(null);
    } catch (e) {
      setMsgListError(e.message || "Could not load conversations");
    }
    setMsgListLoading(false);
  }

  async function loadUnreadCount() {
    if (!authUserRef.current) return;
    try {
      const { data, error } = await sb.rpc('get_total_unread_count');
      if (!error && typeof data === 'number') setMsgUnreadTotal(data);
    } catch { /* non-critical — badge reconciles on next fetch */ }
  }

  async function loadChannelMessages(channelId) {
    // Token this request so a slow fetch for a channel the user has since left
    // (or that resolves after a newer load) can't paint stale history — and so
    // its error/loading writes are also ignored once superseded.
    const seq = ++loadSeqRef.current;
    setMsgLoading(true);
    try {
      const { data, error } = await sb.rpc('get_channel_messages', {
        p_channel_id: channelId,
        p_limit: 50,
      });
      if (seq !== loadSeqRef.current) return; // superseded by a newer load
      if (error) throw error;
      // Merge, don't replace: preserve optimistic sends and realtime rows that
      // arrived during the fetch instead of clobbering them with the snapshot.
      setMsgMessages(prev => mergeSnapshot(prev, data || []));
      setMsgChatError(null);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setMsgChatError(e.message || "Could not load messages");
    } finally {
      if (seq === loadSeqRef.current) setMsgLoading(false);
    }
  }

  /** Open an existing conversation from the list. */
  function openConversation(conv) {
    setMsgActiveChannel(conv);
    setMsgView("chat");
    setMsgChatError(null);
    setMsgMessages([]);
    // Server marks the channel read inside get_channel_messages; mirror it
    // locally so badges clear instantly.
    setMsgUnreadTotal(t => Math.max(0, t - (conv.unread_count || 0)));
    setMsgConversations(prev => clearConversationUnread(prev, conv.channel_id));
    loadChannelMessages(conv.channel_id);
  }

  /** Back out of the chat view to the conversation list. */
  function closeConversation() {
    setMsgView("list");
    setMsgActiveChannel(null);
    setMsgMessages([]);
    loadConversations();
    loadUnreadCount();
  }

  /** Entry point from the Guild tab ("💬 Chat" on a friend card). */
  async function openDmWithUser(otherUserId) {
    if (!authUserRef.current) return;
    setMsgLoading(true);
    try {
      const { data: channelId, error } = await sb.rpc('get_or_create_dm_channel', {
        p_other_user_id: otherUserId,
      });
      if (error) throw error;
      const { data: convos, error: convError } = await sb.rpc('get_my_conversations');
      if (convError) throw convError;
      listLoadedRef.current = true;
      setMsgConversations(convos || []);
      const chan = (convos || []).find(c => c.channel_id === channelId);
      if (chan) {
        setMsgActiveChannel(chan);
        setMsgView("chat");
        // loadChannelMessages owns msgLoading from here — don't clear it early
        // or the spinner vanishes before the message window arrives.
        loadChannelMessages(channelId);
      } else {
        setMsgView("list");
        setMsgLoading(false);
      }
      if (onOpenChat) onOpenChat();
    } catch (e) {
      showToastRef.current("Could not open chat: " + (e.message || e));
      setMsgLoading(false);
    }
  }

  async function deliverMessage(channelId, content, tmpId) {
    try {
      const { data: newId, error } = await sb.rpc('send_message', {
        p_channel_id: channelId,
        p_content: content,
      });
      if (error) throw error;
      setMsgMessages(list => resolveOptimistic(list, tmpId, newId));
    } catch (e) {
      setMsgMessages(list => failOptimistic(list, tmpId));
      showToastRef.current("Send failed: " + (e.message || e));
    }
  }

  /** Optimistic send — bubble appears instantly, input stays live. */
  function sendMsg() {
    const me = authUserRef.current;
    const active = activeChannelRef.current;
    const content = msgInput.trim();
    if (!me || !active || !content) return;
    const tmp = buildOptimisticMessage(content, me.id);
    setMsgMessages(list => [...list, tmp]);
    setMsgInput("");
    setMsgConversations(prev => applyLocalSendToConversations(prev, active.channel_id, content, me.id));
    deliverMessage(active.channel_id, content, tmp.id);
  }

  /** Re-send a failed optimistic bubble. */
  function retryFailedMsg(tmpId) {
    const active = activeChannelRef.current;
    const failedMsg = msgMessages.find(m => m.id === tmpId && m.failed);
    if (!active || !failedMsg) return;
    setMsgMessages(list => list.map(m => (m.id === tmpId ? { ...m, failed: false, pending: true } : m)));
    deliverMessage(active.channel_id, failedMsg.content, tmpId);
  }

  /** Drop a failed optimistic bubble without resending. */
  function discardFailedMsg(tmpId) {
    setMsgMessages(list => removeMessage(list, tmpId));
  }

  // Debounced background reconcile — keeps list/badges honest even if a
  // realtime event was missed or arrived for an unknown channel.
  const reconcileTimerRef = useRef(null);
  function scheduleReconcile() {
    if (reconcileTimerRef.current) return;
    reconcileTimerRef.current = setTimeout(() => {
      reconcileTimerRef.current = null;
      loadConversations();
      loadUnreadCount();
    }, 3000);
  }

  function handleIncoming(row) {
    const me = authUserRef.current;
    if (!me || !row || row.deleted_at) return;
    const active = activeChannelRef.current;
    if (active && row.channel_id === active.channel_id) {
      setMsgMessages(list => mergeIncomingMessage(list, normalizeIncomingRow(row, me.id, active)));
      if (row.sender_id !== me.id) {
        // Reading it live — tell the server without refetching the window.
        sb.rpc('mark_channel_read', { p_channel_id: row.channel_id }).then(() => {}, () => {});
        setMsgConversations(prev => {
          const next = applyIncomingToConversations(prev, row);
          return next ? clearConversationUnread(next, row.channel_id) : prev;
        });
      }
    } else if (row.sender_id !== me.id) {
      setMsgUnreadTotal(t => t + 1);
      setMsgConversations(prev => applyIncomingToConversations(prev, row) || prev);
      scheduleReconcile();
    }
  }
  // Keep the "latest value" refs current (runs after every render).
  useEffect(() => {
    authUserRef.current = authUser;
    activeChannelRef.current = msgActiveChannel;
    showToastRef.current = showToast;
    handleIncomingRef.current = handleIncoming;
  });

  // One realtime subscription per signed-in user. RLS scopes delivery to
  // channels the user is a member of. Resubscribes with backoff on channel
  // errors; refetches on tab-refocus to cover anything missed while hidden.
  useEffect(() => {
    if (!authUser?.id) return;
    let disposed = false;
    let channel = null;
    let retryTimer = null;
    const subscribe = () => {
      if (disposed) return;
      channel = sb.channel('messages-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
          payload => handleIncomingRef.current(payload.new))
        .subscribe(status => {
          if (disposed) return;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            sb.removeChannel(channel);
            channel = null;
            retryTimer = setTimeout(subscribe, 4000);
          }
        });
    };
    subscribe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadConversations();
        loadUnreadCount();
        const active = activeChannelRef.current;
        if (active) loadChannelMessages(active.channel_id);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) sb.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
     
  }, [authUser?.id]);

  // Initial load on sign-in / reset on sign-out. Deferred a tick so the
  // fetch-then-setState churn happens outside the effect body.
  useEffect(() => {
    const t = setTimeout(() => {
      if (authUser?.id) {
        loadConversations();
        loadUnreadCount();
      } else {
        listLoadedRef.current = false;
        setMsgConversations([]);
        setMsgMessages([]);
        setMsgActiveChannel(null);
        setMsgUnreadTotal(0);
        setMsgView("list");
      }
    }, 0);
    return () => clearTimeout(t);
     
  }, [authUser?.id]);

  return {
    msgView, setMsgView,
    msgConversations,
    msgActiveChannel,
    msgMessages,
    msgInput, setMsgInput,
    msgLoading,
    msgListLoading,
    msgListError,
    msgChatError,
    msgUnreadTotal,
    loadConversations,
    loadUnreadCount,
    loadChannelMessages,
    openConversation,
    closeConversation,
    openDmWithUser,
    sendMsg,
    retryFailedMsg,
    discardFailedMsg,
  };
}
