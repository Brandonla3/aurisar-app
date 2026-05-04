/**
 * Extracts ProfileTab from App.jsx.
 *
 * Combines four conditional sub-views (VIEW / EDIT / SECURITY / NOTIFICATION)
 * that were each guarded by `activeTab === "profile"` into a single component.
 *
 * Run with: node scripts/build_profile_tab.cjs
 */
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'src', 'App.jsx');
const outPath = path.join(__dirname, '..', 'src', 'features', 'profile', 'ProfileTab.jsx');

const raw = fs.readFileSync(appPath, 'utf8');
const src = raw.replace(/\r\n/g, '\n');

// ── Find extraction boundaries ────────────────────────────────────────────────

// The VIEW block opens with `{activeTab === "profile" && !editMode`. It's
// preceded by the comment `/* ── PROFILE VIEW ... */}` which is the tail of
// the CharacterTab expression. We extract from the `{` that opens VIEW onward.
const OPEN_COMMENT = '/* ── PROFILE VIEW ─────────────────────── */}';
const openCommentIdx = src.indexOf(OPEN_COMMENT);
if (openCommentIdx === -1) throw new Error('Cannot find PROFILE VIEW opening comment!');
// body starts at the `{` right after `*/}`
const bodyStart = openCommentIdx + OPEN_COMMENT.length;

// After all four profile blocks, the scroll-area div closes
const SCROLL_MARKER = '</div> {\n        /* scroll-area */';
const scrollIdx = src.indexOf(SCROLL_MARKER, openCommentIdx);
if (scrollIdx === -1) throw new Error('Cannot find scroll-area marker!');

// Extract body (the 4 expression blocks, ending with the `}` before `</div>`)
let body = src.slice(bodyStart, scrollIdx);

console.log(`Profile block: char ${bodyStart} → ${scrollIdx} (${body.split('\n').length} lines)`);

// ── Transform the body ────────────────────────────────────────────────────────

// 1. Strip `activeTab === "profile" && ` from each of the 4 conditional openers
body = body.replace(/\{activeTab === "profile" && /g, '{');

// 2. De-indent by 8 spaces (App.jsx render uses 8-space base for this section)
body = body.split('\n').map(l => l.startsWith('        ') ? l.slice(8) : l).join('\n');

// ── Compose the file ──────────────────────────────────────────────────────────

const fileHeader = `import React, { memo } from 'react';
import { calcBMI, xpToLevel } from '../../utils/xp';
import { isMetric, lbsToKg, kgToLbs, ftInToCm, cmToFtIn } from '../../utils/units';
import { S, R, FS } from '../../utils/tokens';
import { UI_COLORS } from '../../data/constants';
import { CLASSES } from '../../data/exercises';
import { ClassIcon } from '../../components/ClassIcon';

/**
 * Profile tab — extracted from the four inline JSX blocks in App.jsx as part
 * of Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Combines VIEW / EDIT / SECURITY SETTINGS / NOTIFICATION PREFERENCES
 * sub-views that were each guarded by activeTab === "profile" + a mode flag.
 */
`;

const componentOpen = `
const ProfileTab = memo(function ProfileTab({
  // Profile data
  profile, setProfile,
  cls,
  level,
  authUser,
  // View mode
  editMode, setEditMode,
  securityMode, setSecurityMode,
  notifMode, setNotifMode,
  // Edit form
  draft, setDraft,
  // Email change
  emailPanelOpen, setEmailPanelOpen,
  newEmail, setNewEmail,
  emailMsg, setEmailMsg,
  showEmail, setShowEmail,
  // Account IDs
  showPrivateId, setShowPrivateId,
  myPublicId,
  myPrivateId,
  // MFA
  mfaPanelOpen, setMfaPanelOpen,
  mfaEnrolling, setMfaEnrolling,
  mfaQR, setMfaQR,
  mfaSecret, setMfaSecret,
  mfaCode, setMfaCode,
  mfaMsg, setMfaMsg,
  mfaEnabled,
  mfaUnenrolling,
  mfaRecoveryCodes, setMfaRecoveryCodes,
  mfaCodesRemaining,
  mfaHasLegacyCodes,
  mfaDisableConfirm, setMfaDisableConfirm,
  mfaDisableCode, setMfaDisableCode,
  mfaDisableMsg, setMfaDisableMsg,
  // Password change
  pwPanelOpen, setPwPanelOpen,
  pwNew, setPwNew,
  pwConfirm, setPwConfirm,
  pwMsg, setPwMsg,
  // Phone change
  phonePanelOpen, setPhonePanelOpen,
  phoneInput, setPhoneInput,
  setPhoneOtpSent,
  setPhoneOtpCode,
  phoneMsg, setPhoneMsg,
  // PB filter
  pbFilterOpen, setPbFilterOpen,
  pbSelectedFilters, setPbSelectedFilters,
  // Password show/hide toggle
  showPwProfile, setShowPwProfile,
  // Callbacks
  saveEdit,
  openEdit,
  changePassword,
  changeEmailAddress,
  resetChar,
  verifyMfaEnroll,
  confirmMfaDisableWithTotp,
  guardRecoveryCodes,
  toggleNameVisibility,
  toggleNotifPref,
  profileComplete,
  showToast,
}) {
return (
<>
`;

const componentClose = `
</>
);
});

export default ProfileTab;
`;

const finalContent = [fileHeader, componentOpen, body, componentClose].join('');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, finalContent, 'utf8');

const outLines = finalContent.split('\n').length;
console.log(`Written: ${outPath}`);
console.log(`Lines: ${outLines}`);
console.log(`Bytes: ${Buffer.byteLength(finalContent, 'utf8')}`);
