import React, { memo, useState } from 'react';
import AvatarCreator from '../avatar/AvatarCreator.jsx';
import { UI_COLORS } from '../../data/constants';
import { calcCharStats } from '../../utils/xp';
import { ClassIcon } from '../../components/ClassIcon';
import { S, R, FS } from '../../utils/tokens';

/**
 * Character tab — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Pure presentational tab. State + setters come in as props from App;
 * no derivation work to lift into a hook.
 *
 * Wrapped in React.memo so unrelated App re-renders don't drag this tab
 * into a re-render when none of its props changed.
 */

// ── Module-level constants (hoisted from the IIFE) ──
const STAT_META = {
  STR: { label: "Strength", icon: "💪", color: UI_COLORS.danger },
  END: { label: "Endurance", icon: "🔥", color: "#e67e22" },
  DEX: { label: "Dexterity", icon: "⚡", color: UI_COLORS.accent },
  CON: { label: "Constitution", icon: "🛡️", color: "#27ae60" },
  INT: { label: "Intelligence", icon: "🔮", color: UI_COLORS.accent },
  CHA: { label: "Charisma", icon: "✨", color: "#e91e8c" },
  WIS: { label: "Wisdom", icon: "🌿", color: "#1abc9c" },
  VIT: { label: "Vitality", icon: "❤️", color: UI_COLORS.danger },
};

const EQUIP_SLOTS = [
  { key: "slot_helmet",      icon: "⛑️",  label: "Helmet",    hint: "INT / WIS" },
  { key: "slot_glasses",     icon: "👓",  label: "Glasses",   hint: "INT cosmetic" },
  { key: "slot_shoulders",   icon: "🦺",  label: "Shoulders", hint: "CON / STR" },
  { key: "slot_chest",       icon: "👕",  label: "Chest",     hint: "VIT / CON" },
  { key: "slot_belt",        icon: "🩱",  label: "Belt",      hint: "STR / CON" },
  { key: "slot_gloves",      icon: "🧤",  label: "Gloves",    hint: "STR / DEX" },
  { key: "slot_legs",        icon: "👖",  label: "Legs",      hint: "DEX / END" },
  { key: "slot_shoes",       icon: "👟",  label: "Shoes",     hint: "DEX / END" },
  { key: "slot_weapon_main", icon: "⚔️",  label: "Weapon",    hint: "STR / CHA" },
  { key: "slot_weapon_off",  icon: "🛡️",  label: "Off-hand",  hint: "DEX / CON" },
];

const CharacterTab = memo(function CharacterTab({
  // Character data
  profile,
  cls,
  level,
  clsKey,
  // Display
  myPublicId,
  // Sub-tab state
  charSubTab, setCharSubTab,
  // Avatar creator
  avatarConfig,
  onSaveAvatar,
  savingAvatar,
}) {
  const [creatorOpen, setCreatorOpen] = useState(false);
  const charStats = calcCharStats(cls, level, clsKey, profile);
  const statMax = Math.max(...Object.values(charStats));

  // `profile.equipment` is read but never written via setProfile —
  // it's intentionally a write-once-via-rewards / read-only-from-app
  // shape that doesn't yet have a setter.
  const equipment = profile.equipment || {};
  const isStyleUnlocked = s => {
    if (s.unlockRace && profile.avatarRace !== s.unlockRace) return false;
    if (s.unlockDrop) return false;
    return level >= (s.unlockLevel || 1);
  };
  const rune = label => <div className={"profile-rune-divider"} style={{
    margin: "0 0 10px"
  }}><span className={"profile-rune-label"}>{`⠿ ${label} ⠿`}</span></div>;

  return <div style={{
    "--cls-color": cls.color,
    "--cls-glow": cls.glow
  }}><div className={"profile-hero"} style={{
      marginBottom: S.s12
    }}><div className={"profile-hero-inner"}><div className={"profile-hero-top"}><div className={"profile-avatar-ring"} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}><ClassIcon classKey={profile.chosenClass} size={36} color={cls.glow} /></div><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"profile-name"}>{profile.playerName}{myPublicId && <span style={{
                    fontSize: FS.fs58,
                    color: "#8a8478",
                    fontWeight: 400,
                    marginLeft: S.s8,
                    letterSpacing: ".03em"
                  }}>{"#" + myPublicId}</span>}</div><div className={"profile-class-line"}>{cls.name}{" · Level "}{level}</div>{profile.disciplineTrait && <span className={"trait"} style={{
                  "--cls-color": cls.color,
                  "--cls-glow": cls.glow,
                  fontSize: FS.fs65
                }}>{profile.disciplineTrait}</span>}</div></div><div className={"profile-rune-divider"} style={{
              margin: "10px 0 8px"
            }}><span className={"profile-rune-label"}>{"⠿ Class Traits ⠿"}</span></div><div className={"traits"}>{cls.traits.map(t => <span key={t} className={"trait"} style={{
                "--cls-color": cls.color,
                "--cls-glow": cls.glow
              }}>{t}</span>)}</div></div></div>

      {
        /* ── SUB-TABS ── */
      }<div style={{
        display: "flex",
        gap: S.s6,
        marginBottom: S.s12
      }}>{["avatar", "stats", "equipment"].map(t => <button key={t} onClick={() => setCharSubTab(t)} className={`char-sub-btn${charSubTab === t ? " sel" : ""}`} style={{
            flex: 1,
            textAlign: "center",
            padding: "8px 4px"
          }}>{t === "avatar" ? "⚔️ Avatar" : t === "stats" ? "📊 Stats" : "🎒 Equipment"}</button>)}</div>

      {
        /* ══ AVATAR SUB-TAB ══════════════════════════ */
      }{charSubTab === "avatar" && <div>
        <div className={"char-section"} style={{ textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: "2.6rem", marginBottom: S.s14 }}>{"⚔️"}</div>
          <div style={{ fontSize: FS.fs95, color: "#b4ac9e", fontWeight: 600, marginBottom: S.s8, letterSpacing: ".02em" }}>
            {"Appearance"}
          </div>
          <div style={{ fontSize: FS.fs76, color: "#8a8478", lineHeight: 1.7, maxWidth: 240, margin: "0 auto 20px" }}>
            {"Customise your body, face, hair, species features, and base outfit."}
          </div>
          <button
            onClick={() => setCreatorOpen(true)}
            style={{
              background: "linear-gradient(135deg,#3b82f6,#6366f1)",
              border: "none",
              borderRadius: R.r12,
              color: "#fff",
              fontSize: FS.fs95,
              fontWeight: 600,
              padding: "10px 28px",
              cursor: "pointer",
              fontFamily: "Inter, system-ui, sans-serif",
              letterSpacing: ".02em",
            }}
          >
            {"Edit Appearance"}
          </button>
        </div>
        {creatorOpen && (
          <AvatarCreator
            initialConfig={avatarConfig}
            saving={savingAvatar}
            onSave={async (cfg) => { await onSaveAvatar?.(cfg); setCreatorOpen(false); }}
            onCancel={() => setCreatorOpen(false)}
          />
        )}
      </div>
      /* ══ STATS SUB-TAB ════════════════════════════ */}{charSubTab === "stats" && <div><div className={"char-section"}>{rune("Character Stats")}<div style={{
            fontSize: FS.sm,
            color: "#8a8478",
            fontStyle: "italic",
            textAlign: "center",
            marginBottom: S.s10
          }}>{"Stats grow dynamically as you train — full calculation coming soon"}</div>{Object.entries(STAT_META).map(([key, meta]) => {
            const val = charStats[key] || 0,
              pct = Math.round(val / statMax * 100);
            return <div key={key} className={"char-stat-row"}><span className={"char-stat-icon"}>{meta.icon}</span><span className={"char-stat-label"} style={{
                width: 80
              }}>{meta.label}</span><div className={"char-stat-bar"}><div className={"char-stat-fill"} style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg,${meta.color}99,${meta.color})`
                }} /></div><span className={"char-stat-val"}>{val}</span></div>;
          })}</div></div>

      /* ══ EQUIPMENT SUB-TAB ═══════════════════════ */}{charSubTab === "equipment" && <div><div className={"char-section"}>{rune("Equipment")}<div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "7px"
          }}>{EQUIP_SLOTS.map(slot => {
              const item = equipment[slot.key] || null;
              return <div key={slot.key} className={"char-equip-slot"}><div className={"char-equip-icon"} style={{
                  width: 30,
                  height: 30,
                  borderRadius: R.r7,
                  border: `1px solid ${item ? "rgba(180,172,158,.1)" : "rgba(180,172,158,.06)"}`,
                  background: item ? "rgba(45,42,36,.18)" : "rgba(45,42,36,.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1rem"
                }}>{slot.icon}</div><div style={{
                  flex: 1,
                  minWidth: 0
                }}><div className={"char-equip-label"} style={{
                    fontWeight: 600
                  }}>{slot.label}</div><div className={"char-equip-name"} style={{
                    color: item ? "#b4ac9e" : "#8a8478"
                  }}>{item || slot.hint}</div></div></div>;
            })}</div><div style={{
            fontSize: FS.fs62,
            color: "#8a8478",
            fontStyle: "italic",
            textAlign: "center",
            marginTop: S.s8
          }}>{"Earn gear through dungeons and quests in the 3D World"}</div></div></div>}</div>;
});

export default CharacterTab;
