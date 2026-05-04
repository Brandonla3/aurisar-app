import React, { memo } from 'react';
import { CLASSES } from '../../data/exercises';
import { UI_COLORS } from '../../data/constants';
import { buildXPTable } from '../../utils/xp';
import { formatXP } from '../../utils/format';
import { S, R, FS } from '../../utils/tokens';

/**
 * Guild (Social) tab — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Pure presentational tab. State + setters come in as props from App;
 * no derivation work to lift into a hook.
 *
 * Wrapped in React.memo so unrelated App re-renders don't drag this tab
 * into a re-render when none of its props changed.
 */

// Hoist out of render — same 100-level table on every call
const _XP_TABLE_100 = buildXPTable(100);
const levelFor = xp => {
  let lv = 1;
  for (let i = 1; i < _XP_TABLE_100.length; i++) {
    if (xp >= _XP_TABLE_100[i]) lv = i + 1; else break;
  }
  return lv;
};

const GuildTab = memo(function GuildTab({
  // Status message (search result feedback, errors)
  socialMsg,
  // Search bar
  friendSearch, setFriendSearch,
  friendSearchResult, setFriendSearchResult,
  setSocialMsg,
  searchFriendByEmail,
  friendSearchLoading,
  // Friend request actions
  sendFriendRequest,
  rescindFriendRequest,
  // Incoming requests
  friendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  // Incoming shares
  incomingShares,
  acceptShare,
  declineShare,
  // Outgoing pending requests
  outgoingRequests,
  // Friends list
  friends,
  removeFriend,
  friendRecentEvents,
  // Auth
  authUser,
  // Loading / refresh
  socialLoading,
  loadSocialData,
  loadIncomingShares,
  // Action callbacks (defined in App)
  openDmWithUser,
  setShareModal,
}) {
  return <div><div className={"rpg-sec-header"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Guild Search ✦"}</span><div className={"rpg-sec-line rpg-sec-line-r"} /></div>{socialMsg && <div style={{
      fontSize: FS.fs75,
      color: socialMsg.ok === true ? UI_COLORS.success : socialMsg.ok === false ? UI_COLORS.danger : "#b4ac9e",
      marginBottom: S.s10,
      padding: "8px 12px",
      background: socialMsg.ok === true ? "rgba(46,204,113,.06)" : socialMsg.ok === false ? "rgba(231,76,60,.06)" : "rgba(45,42,36,.16)",
      border: `1px solid ${socialMsg.ok === true ? "rgba(46,204,113,.2)" : socialMsg.ok === false ? "rgba(231,76,60,.2)" : "rgba(45,42,36,.3)"}`,
      borderRadius: R.lg,
      textAlign: "center"
    }}>{socialMsg.text}</div>}<div style={{
      display: "flex",
      gap: S.s8,
      marginBottom: S.s8
    }}><input className={"inp"} style={{
        flex: 1,
        padding: "8px 12px",
        fontSize: FS.fs82
      }} placeholder={"Email or Account ID (#A7XK9M)…"} value={friendSearch} onChange={e => {
        setFriendSearch(e.target.value);
        setFriendSearchResult(null);
        setSocialMsg(null);
      }} onKeyDown={e => {
        if (e.key === "Enter") searchFriendByEmail();
      }} /><button className={"btn btn-ghost btn-sm"} style={{
        flexShrink: 0,
        opacity: friendSearchLoading || !friendSearch.trim() ? 0.4 : 1
      }} disabled={friendSearchLoading || !friendSearch.trim()} onClick={searchFriendByEmail}>{friendSearchLoading ? "…" : "Search"}</button></div>
      {
        /* Search result */
      }{socialMsg === null && friendSearchResult && <div style={{
        background: "rgba(45,42,36,.18)",
        border: "1px solid rgba(180,172,158,.06)",
        borderRadius: R.r10,
        padding: "10px 12px",
        marginBottom: S.s12
      }}>{friendSearchResult.found ? (() => {
          const u = friendSearchResult.user;
          const uCls = u.chosenClass ? CLASSES[u.chosenClass] : null;
          const ex = friendSearchResult.existing;
          return <div><div style={{
              display: "flex",
              alignItems: "center",
              gap: S.s10
            }}><div className={"friend-avatar"}>{uCls?.icon || "⚔️"}</div><div style={{
                flex: 1
              }}><div className={"friend-name"}>{u.playerName || "Unnamed Warrior"}{u.publicId && <span style={{
                    fontSize: FS.fs58,
                    color: "#8a8478",
                    fontWeight: 400,
                    marginLeft: S.s6
                  }}>{"#" + u.publicId}</span>}</div><div className={"friend-meta"}>{uCls?.name || "Unknown"}{friendSearchResult.matchType === "account_id" ? " · Found by Account ID" : " · Found by email"}</div></div>{!ex && <button className={"btn btn-gold btn-xs"} onClick={() => sendFriendRequest(u.id)}>{"+ Add"}</button>}{ex?.status === "pending" && <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: S.s4
              }}><span style={{
                  fontSize: FS.fs62,
                  color: "#8a8478",
                  fontStyle: "italic"
                }}>{"Request pending…"}</span><button className={"btn btn-ghost btn-xs"} style={{
                  fontSize: FS.fs58,
                  color: UI_COLORS.danger,
                  borderColor: "rgba(231,76,60,.3)",
                  padding: "2px 8px"
                }} onClick={() => rescindFriendRequest(ex.id, u.id)}>{"Rescind"}</button></div>}{ex?.status === "accepted" && <span style={{
                fontSize: FS.fs65,
                color: UI_COLORS.success
              }}>{"Already friends ✓"}</span>}</div></div>;
        })() : <div style={{
          fontSize: FS.fs75,
          color: "#8a8478",
          fontStyle: "italic"
        }}>{friendSearchResult.msg}</div>}</div>
      /* Incoming requests */}{friendRequests.length > 0 && <><div className={"sec"} style={{
          marginBottom: S.s8
        }}>{"⚔️ Incoming Requests"}</div>{friendRequests.map(r => <div key={r.reqId} className={"req-card"}><div style={{
            flex: 1
          }}><div style={{
              fontSize: FS.fs78,
              color: "#d4cec4"
            }}>{r.playerName}</div><div style={{
              fontSize: FS.fs62,
              color: "#8a8478",
              marginTop: S.s2
            }}>{"Wants to join your party"}</div></div><button className={"btn btn-gold btn-xs"} style={{
            marginRight: S.s6
          }} onClick={() => acceptFriendRequest(r.reqId)}>{"Accept"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => rejectFriendRequest(r.reqId)}>{"Decline"}</button></div>)}</>

      /* Incoming shared items */}{incomingShares.length > 0 && <><div className={"sec"} style={{
          marginBottom: S.s8
        }}>{"📦 Incoming Shares"}</div>{incomingShares.map(s => <div key={s.id} className={"req-card"} style={{
          flexDirection: "column",
          alignItems: "stretch",
          gap: S.s8
        }}><div style={{
            display: "flex",
            alignItems: "center",
            gap: S.s8
          }}><span style={{
              fontSize: "1.1rem"
            }}>{s.type === "workout" ? "💪" : "⚡"}</span><div style={{
              flex: 1
            }}><div style={{
                fontSize: FS.fs78,
                color: "#d4cec4"
              }}>{s.parsedItem?.name || "Unnamed"}</div><div style={{
                fontSize: FS.fs62,
                color: "#8a8478",
                marginTop: S.s2
              }}>{s.senderName}{" shared a "}{s.type}{" with you"}</div></div></div>{s.parsedItem?.desc && <div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            fontStyle: "italic",
            paddingLeft: 28
          }}>{s.parsedItem.desc.slice(0, 80)}{s.parsedItem.desc.length > 80 ? "…" : ""}</div>}<div style={{
            display: "flex",
            gap: S.s6,
            paddingLeft: 28
          }}><button className={"btn btn-gold btn-xs"} style={{
              flex: 1
            }} onClick={() => acceptShare(s)}>{"✓ Add to Mine"}</button><button className={"btn btn-ghost btn-xs"} style={{
              flex: 1
            }} onClick={() => declineShare(s.id)}>{"Decline"}</button></div></div>)}</>

      /* Outgoing pending requests */}{outgoingRequests.length > 0 && <><div className={"sec"} style={{
          marginBottom: S.s8,
          marginTop: S.s12
        }}>{"📤 Pending Sent ("}{outgoingRequests.length}{")"}</div>{outgoingRequests.map(r => <div key={r.reqId} className={"req-card"}><div style={{
            flex: 1
          }}><div style={{
              fontSize: FS.fs78,
              color: "#d4cec4"
            }}>{r.playerName}</div><div style={{
              fontSize: FS.fs62,
              color: "#8a8478",
              marginTop: S.s2
            }}>{"Awaiting their response…"}</div></div><button className={"btn btn-ghost btn-xs"} style={{
            flexShrink: 0,
            fontSize: FS.fs65,
            color: UI_COLORS.danger,
            borderColor: "rgba(231,76,60,.3)"
          }} onClick={() => rescindFriendRequest(r.reqId, r.userId)}>{"Rescind"}</button></div>)}</>

      /* Friends list */}<div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: S.s8,
        marginTop: friendRequests.length > 0 || incomingShares.length > 0 || outgoingRequests.length > 0 ? 12 : 0
      }}><div className={"sec"} style={{
          margin: 0,
          border: "none",
          padding: S.s0
        }}>{"👥 My Party ("}{friends.length}{")"}</div>{authUser && <button className={"btn btn-ghost btn-xs"} style={{
          fontSize: FS.fs58
        }} onClick={() => {
          loadSocialData();
          loadIncomingShares();
        }}>{socialLoading ? "…" : "↺ Refresh"}</button>}</div>{!authUser && <div className={"empty"}>{"Sign in to see your friends."}</div>}{authUser && socialLoading && <div className={"empty"}>{"Loading your party…"}</div>}{authUser && !socialLoading && friends.length === 0 && <div className={"empty"}>{"No friends yet."}<br />{"Search by email to find other warriors."}</div>}{friends.map(f => {
        const fCls = f.chosenClass ? CLASSES[f.chosenClass] : null;
        const fLevel = levelFor(f.xp || 0);
        const recentEv = friendRecentEvents[f.id];
        const recent = recentEv ? `${recentEv.exercise_icon || "💪"} ${recentEv.exercise_name || recentEv.exercise_id}` : null;
        return <div key={f.id} className={"friend-card"}><div className={"friend-card-top"}><div className={"friend-avatar"} style={{
              borderColor: fCls?.color || "rgba(45,42,36,.3)"
            }}>{fCls?.icon || "⚔️"}</div><div style={{
              flex: 1,
              minWidth: 0
            }}><div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}><div className={"friend-name"}>{f.playerName || "Unnamed Warrior"}</div><div style={{
                  display: "flex",
                  gap: S.s4
                }}><button className={"btn btn-ghost btn-xs"} style={{
                    fontSize: FS.fs55,
                    color: UI_COLORS.info,
                    padding: "2px 6px"
                  }} onClick={() => openDmWithUser(f.id)}>{"💬 Chat"}</button><button className={"btn btn-ghost btn-xs"} style={{
                    fontSize: FS.fs55,
                    color: "#b4ac9e",
                    padding: "2px 6px"
                  }} onClick={() => setShareModal({
                    step: "pick-type",
                    friendId: f.id,
                    friendName: f.playerName || "this warrior"
                  })}>{"⇪ Share"}</button><button className={"btn btn-ghost btn-xs"} style={{
                    fontSize: FS.fs55,
                    color: "#8a8478",
                    padding: "2px 6px"
                  }} onClick={() => removeFriend(f._reqId)}>{"Remove"}</button></div></div><div className={"friend-meta"}><span style={{
                  color: fCls?.color || "#b4ac9e"
                }}>{fCls?.name || "Unknown"}</span>{" · "}{"Level "}{fLevel}{" · "}<span style={{
                  color: "#b4ac9e"
                }}>{formatXP(f.xp || 0, {
                    prefix: "⚡ "
                  })}</span></div></div></div>{recent && <div className={"friend-recent"}><span style={{
              color: "#8a8478",
              marginRight: S.s6
            }}>{"Latest:"}</span>{recent}</div>}{!recent && <div className={"friend-recent"} style={{
            color: "#8a8478",
            fontStyle: "italic"
          }}>{"No workouts logged yet"}</div>}</div>;
      })}</div>;
});

export default GuildTab;
