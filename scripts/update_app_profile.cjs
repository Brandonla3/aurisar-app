/**
 * Updates App.jsx for the ProfileTab extraction:
 *   1. Adds import for ProfileTab
 *   2. Replaces the four profile JSX blocks with <ProfileTab ... />
 *
 * Run with: node scripts/update_app_profile.cjs
 */
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'src', 'App.jsx');
const raw = fs.readFileSync(appPath, 'utf8');
const hasCRLF = raw.includes('\r\n');
let src = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;

// ─── 1. Add import ─────────────────────────────────────────────────────────
const importAnchor = "import LeaderboardTab from './features/leaderboard/LeaderboardTab';";
const profileImport = "import ProfileTab from './features/profile/ProfileTab';";
if (src.includes(profileImport)) {
  console.log('Import already present — skipping.');
} else {
  src = src.replace(importAnchor, importAnchor + '\n' + profileImport);
  console.log('Import added.');
}

// ─── 2. Replace the four profile blocks ───────────────────────────────────
// OPEN_NEEDLE: matches from the PROFILE VIEW comment (which is the tail of
// the CharacterTab expression block) through the first conditional opener.
const OPEN_NEEDLE = `        /* ── PROFILE VIEW ─────────────────────── */}{activeTab === "profile" && !editMode && !securityMode && !notifMode && <div`;

// SCROLL_MARKER: the scroll-area div closing that immediately follows the last
// profile block (notifMode block ends with </>} just before this).
const SCROLL_MARKER = `</div> {\n        /* scroll-area */`;

const openIdx = src.indexOf(OPEN_NEEDLE);
if (openIdx === -1) throw new Error('Could not find PROFILE VIEW opening!');

const scrollIdx = src.indexOf(SCROLL_MARKER, openIdx);
if (scrollIdx === -1) throw new Error('Could not find scroll-area marker after profile blocks!');

console.log(`Profile block open at char ${openIdx}, scroll-area at char ${scrollIdx}`);

const replacement = `        /* ── PROFILE TAB ─────────────────────────── */}{activeTab === "profile" && (
          <ProfileTab
            profile={profile}
            setProfile={setProfile}
            cls={cls}
            level={level}
            authUser={authUser}
            editMode={editMode}
            setEditMode={setEditMode}
            securityMode={securityMode}
            setSecurityMode={setSecurityMode}
            notifMode={notifMode}
            setNotifMode={setNotifMode}
            draft={draft}
            setDraft={setDraft}
            emailPanelOpen={emailPanelOpen}
            setEmailPanelOpen={setEmailPanelOpen}
            newEmail={newEmail}
            setNewEmail={setNewEmail}
            emailMsg={emailMsg}
            setEmailMsg={setEmailMsg}
            showEmail={showEmail}
            setShowEmail={setShowEmail}
            showPrivateId={showPrivateId}
            setShowPrivateId={setShowPrivateId}
            myPublicId={myPublicId}
            myPrivateId={myPrivateId}
            mfaPanelOpen={mfaPanelOpen}
            setMfaPanelOpen={setMfaPanelOpen}
            mfaEnrolling={mfaEnrolling}
            setMfaEnrolling={setMfaEnrolling}
            mfaQR={mfaQR}
            setMfaQR={setMfaQR}
            mfaSecret={mfaSecret}
            setMfaSecret={setMfaSecret}
            mfaCode={mfaCode}
            setMfaCode={setMfaCode}
            mfaMsg={mfaMsg}
            setMfaMsg={setMfaMsg}
            mfaEnabled={mfaEnabled}
            mfaUnenrolling={mfaUnenrolling}
            mfaRecoveryCodes={mfaRecoveryCodes}
            setMfaRecoveryCodes={setMfaRecoveryCodes}
            mfaCodesRemaining={mfaCodesRemaining}
            mfaHasLegacyCodes={mfaHasLegacyCodes}
            mfaDisableConfirm={mfaDisableConfirm}
            setMfaDisableConfirm={setMfaDisableConfirm}
            mfaDisableCode={mfaDisableCode}
            setMfaDisableCode={setMfaDisableCode}
            mfaDisableMsg={mfaDisableMsg}
            setMfaDisableMsg={setMfaDisableMsg}
            pwPanelOpen={pwPanelOpen}
            setPwPanelOpen={setPwPanelOpen}
            pwNew={pwNew}
            setPwNew={setPwNew}
            pwConfirm={pwConfirm}
            setPwConfirm={setPwConfirm}
            pwMsg={pwMsg}
            setPwMsg={setPwMsg}
            phonePanelOpen={phonePanelOpen}
            setPhonePanelOpen={setPhonePanelOpen}
            phoneInput={phoneInput}
            setPhoneInput={setPhoneInput}
            setPhoneOtpSent={setPhoneOtpSent}
            setPhoneOtpCode={setPhoneOtpCode}
            phoneMsg={phoneMsg}
            setPhoneMsg={setPhoneMsg}
            pbFilterOpen={pbFilterOpen}
            setPbFilterOpen={setPbFilterOpen}
            pbSelectedFilters={pbSelectedFilters}
            setPbSelectedFilters={setPbSelectedFilters}
            showPwProfile={showPwProfile}
            setShowPwProfile={setShowPwProfile}
            saveEdit={saveEdit}
            openEdit={openEdit}
            changePassword={changePassword}
            changeEmailAddress={changeEmailAddress}
            resetChar={resetChar}
            verifyMfaEnroll={verifyMfaEnroll}
            confirmMfaDisableWithTotp={confirmMfaDisableWithTotp}
            guardRecoveryCodes={guardRecoveryCodes}
            toggleNameVisibility={toggleNameVisibility}
            toggleNotifPref={toggleNotifPref}
            profileComplete={profileComplete}
            showToast={showToast}
          />
        )}`;

src = src.slice(0, openIdx) + replacement + src.slice(scrollIdx);

const finalSrc = hasCRLF ? src.replace(/\n/g, '\r\n') : src;
fs.writeFileSync(appPath, finalSrc, 'utf8');
console.log('App.jsx updated.');
console.log('Line count:', src.split('\n').length);
