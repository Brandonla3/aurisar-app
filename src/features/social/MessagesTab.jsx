import React, { memo } from 'react';
import { CLASSES } from '../../data/exercises';
import { UI_COLORS } from '../../data/constants';
import { S, FS } from '../../utils/tokens';
import { ClassIcon } from '../../components/ClassIcon';

/**
 * Messages tab — extracted from the inline IIFE in App.jsx as the
 * fourth slice of Finding #6 (App.jsx decomposition) per
 * docs/performance-audit.md (PR #116).
 *
 * Pure presentational tab. State + setters come in as props from App;
 * no derivation work to lift into a hook (unlike the library tab).
 *
 * Wrapped in React.memo so unrelated App re-renders (toast, xpFlash,
 * modals on other tabs) don't drag the messages tab into a re-render
 * when none of its props changed. Matches the ExerciseLibraryTab and
 * GrimoireGridTab convention.
 */

const MessagesTab = memo(function MessagesTab({
  // Conversation list state
  msgConversations,
  // Active conversation
  msgActiveChannel, setMsgActiveChannel,
  // Chat content
  msgMessages, setMsgMessages,
  msgInput, setMsgInput,
  msgScrollRef,
  // Loading / sending flags
  msgLoading,
  msgSending,
  // View toggle (list ↔ chat)
  msgView, setMsgView,
  // Action callbacks (defined in App)
  sendMsg,
  loadChannelMessages,
  loadConversations,
  loadUnreadCount,
  // Auth (used to label own messages "You: ")
  authUser,
}) {
  const CLASSES_REF = CLASSES;

  // ── Conversation List ──
  if (msgView === "list") {
    return <div><div className={"techniques-header"}><div className={"tech-hdr-left"}><div className={"tech-ornament-line tech-ornament-line-l"} /><span className={"tech-hdr-title"}>{"✦ Messages ✦"}</span><div className={"tech-ornament-line tech-ornament-line-r"} /></div></div>{msgConversations.length === 0 && <div style={{
        textAlign: "center",
        padding: "30px 14px"
      }}><div style={{
          fontSize: "2.5rem",
          marginBottom: S.s10,
          opacity: .3
        }}>{"💬"}</div><div style={{
          fontSize: FS.fs78,
          color: "#8a8478",
          marginBottom: S.s6
        }}>{"No conversations yet"}</div><div style={{
          fontSize: FS.fs62,
          color: "#8a8478"
        }}>{"Tap "}<span style={{
            color: UI_COLORS.info
          }}>{"💬 Chat"}</span>{" on a friend’s card in the Guild tab to start a conversation."}</div></div>}{msgConversations.map(conv => {
        const other = conv.other_user;
        const otherCls = other ? CLASSES_REF[other.chosen_class] : null;
        const lastMsg = conv.last_message;
        const unread = conv.unread_count || 0;
        const timeAgo = lastMsg ? (() => {
          const diff = Date.now() - new Date(lastMsg.created_at).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 1) return "now";
          if (mins < 60) return mins + "m";
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return hrs + "h";
          const days = Math.floor(hrs / 24);
          return days + "d";
        })() : "";
        return <div key={conv.channel_id} className={`msg-conv-card${unread > 0 ? " unread" : ""}`} onClick={() => {
          setMsgActiveChannel(conv);
          loadChannelMessages(conv.channel_id);
          setMsgView("chat");
        }}>
          // Avatar
          <div className={"msg-avatar"} style={{
            background: (otherCls ? otherCls.color : "#8a8478") + "18",
            border: "1px solid " + (otherCls ? otherCls.color : "#8a8478") + "44"
          }}>{otherCls ? <ClassIcon classKey={other.chosen_class} size={18} color={otherCls.color} /> : "💬"}</div>
          // Name + last message
          <div style={{
            flex: 1,
            minWidth: 0
          }}><div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: S.s6
            }}><span className={"msg-conv-name"} style={{
                fontWeight: unread > 0 ? 700 : 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}>{other ? other.player_name : conv.name || "Chat"}</span><span style={{
                fontSize: FS.fs52,
                color: "#8a8478",
                flexShrink: 0
              }}>{timeAgo}</span></div>{lastMsg && <div className={`msg-conv-preview${unread > 0 ? " unread" : ""}`}>{lastMsg.sender_id === authUser?.id ? "You: " : ""}{lastMsg.content}</div>}{!lastMsg && <div style={{
              fontSize: FS.fs62,
              color: "#8a8478",
              fontStyle: "italic",
              marginTop: S.s2
            }}>{"No messages yet"}</div>}</div>{
          // Unread badge
          unread > 0 && <div className={"msg-unread-badge"}>{unread > 99 ? "99+" : unread}</div>}</div>;
      })}</div>;
  }

  // ── Chat View ──
  const other = msgActiveChannel?.other_user;
  const otherCls = other ? CLASSES_REF[other.chosen_class] : null;
  return <div style={{
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0
  }}>
    // Chat header
    <div className={"msg-chat-hdr"}><button style={{
        background: "transparent",
        border: "none",
        color: "#b4ac9e",
        fontSize: FS.fs82,
        cursor: "pointer",
        padding: "4px"
      }} onClick={() => {
        setMsgView("list");
        setMsgActiveChannel(null);
        setMsgMessages([]);
        loadConversations();
        loadUnreadCount();
      }}>{"←"}</button><div style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        flexShrink: 0,
        background: (otherCls ? otherCls.color : "#8a8478") + "18",
        border: "1.5px solid " + (otherCls ? otherCls.color : "#8a8478") + "44",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: FS.fs85
      }}>{otherCls ? <ClassIcon classKey={other.chosen_class} size={14} color={otherCls.color} /> : "💬"}</div><div style={{
        flex: 1,
        minWidth: 0
      }}><div style={{
          fontSize: FS.fs78,
          fontWeight: 700,
          color: "#d4cec4"
        }}>{other ? other.player_name : "Chat"}</div>{other && <div style={{
          fontSize: FS.fs52,
          color: "#8a8478"
        }}>{otherCls ? otherCls.name : "Unknown"}{" · Lv."}{other.level || 1}{other.public_id ? " · #" + other.public_id : ""}</div>}</div></div>
    // Messages area
    <div ref={msgScrollRef} style={{
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: S.s6,
      scrollbarWidth: "thin",
      scrollbarColor: "rgba(180,172,158,.1) transparent"
    }}>{msgLoading && <div style={{
        textAlign: "center",
        padding: "20px 0"
      }}><div style={{
          width: 20,
          height: 20,
          border: "2px solid rgba(180,172,158,.12)",
          borderTopColor: "#b4ac9e",
          borderRadius: "50%",
          animation: "spin .8s linear infinite",
          margin: "0 auto 6px"
        }} /><div style={{
          fontSize: FS.fs58,
          color: "#8a8478"
        }}>{"Loading…"}</div></div>}{!msgLoading && msgMessages.length === 0 && <div style={{
        textAlign: "center",
        padding: "30px 0",
        fontSize: FS.fs68,
        color: "#8a8478",
        fontStyle: "italic"
      }}>{"No messages yet. Say hello!"}</div>}{!msgLoading && msgMessages.map(msg => {
        const isMine = msg.is_mine;
        const isSystem = msg.message_type === "system" || msg.message_type === "event";
        if (isSystem) {
          return <div key={msg.id} style={{
            textAlign: "center",
            padding: "4px 0"
          }}><span className={"msg-bubble system"}>{msg.content}</span></div>;
        }
        const time = new Date(msg.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
        return <div key={msg.id} style={{
          display: "flex",
          flexDirection: "column",
          alignItems: isMine ? "flex-end" : "flex-start",
          maxWidth: "80%",
          alignSelf: isMine ? "flex-end" : "flex-start"
        }}>{!isMine && <div style={{
            fontSize: FS.fs48,
            color: "#8a8478",
            marginBottom: S.s2,
            marginLeft: S.s4
          }}>{msg.sender_name}</div>}<div className={`msg-bubble ${isMine ? "own" : "other"}`}>{msg.content}</div><div className={"msg-timestamp"} style={{
            marginLeft: S.s4,
            marginRight: S.s4
          }}>{time}{msg.edited_at ? " · edited" : ""}</div></div>;
      })}</div>
    // Input bar
    <div className={"msg-input-bar"}><input className={"msg-input"} placeholder={"Type a message…"} value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMsg();
        }
      }} /><button className={"msg-send-btn"} style={{
        width: 40,
        height: 40,
        opacity: msgInput.trim() ? 1 : .4,
        cursor: msgInput.trim() ? "pointer" : "default"
      }} disabled={msgSending || !msgInput.trim()} onClick={sendMsg}>{msgSending ? "…" : "↑"}</button></div></div>;
});

export default MessagesTab;
