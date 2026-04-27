import { useState } from 'react';

/**
 * Bundle of session-only auth flow state — login, signup, password change,
 * email change, MFA enrollment + challenge, phone OTP, preview-mode PIN.
 *
 * Item 5b of the post-Sprint-3 plan. Mirrors the shape of useUiState
 * (item 5a): each useState is declared here and returned in an object;
 * App.jsx destructures it at the top so existing references are unchanged.
 *
 * What's intentionally NOT here:
 *   - `authUser` itself (the active session). It's not really "auth flow
 *     state" — it's the persisted/active user identity that the rest of
 *     the app reads from. Stays in App for now; could be lifted into a
 *     dedicated `useAuthUser` hook in a follow-up if the auth boundary
 *     gets revisited.
 *   - `previewPinEnabled` — declared with no setter (effectively a
 *     module-level constant). Stays in App.
 *   - `screen` — that's the route, not auth.
 */
export function useAuthState() {
  // ── Login form ───────────────────────────────────────────────────────────
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPw, setShowAuthPw] = useState(false);
  const [authIsNew, setAuthIsNew] = useState(false);
  const [authRemember, setAuthRemember] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMsg, setAuthMsg] = useState(null);

  // ── Login subscreens ─────────────────────────────────────────────────────
  const [loginSubScreen, setLoginSubScreen] = useState(null); // null | "forgot-pw" | "forgot-username"
  const [forgotPwEmail, setForgotPwEmail] = useState("");
  const [forgotPrivateId, setForgotPrivateId] = useState("");
  const [forgotLookupResult, setForgotLookupResult] = useState(null); // null | {found, masked_email, error}

  // ── Preview-mode PIN gate ────────────────────────────────────────────────
  const [showPreviewPin, setShowPreviewPin] = useState(false);
  const [previewPinInput, setPreviewPinInput] = useState("");
  const [previewPinError, setPreviewPinError] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // ── Password change panel (in profile) ───────────────────────────────────
  const [showPwProfile, setShowPwProfile] = useState(false);
  const [pwPanelOpen, setPwPanelOpen] = useState(false);
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState(null);

  // ── Email change panel ───────────────────────────────────────────────────
  const [emailPanelOpen, setEmailPanelOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState(null);
  const [showEmail, setShowEmail] = useState(false);

  // ── User identity display (private/public IDs) ───────────────────────────
  const [myPublicId, setMyPublicId] = useState(null);
  const [myPrivateId, setMyPrivateId] = useState(null);
  const [showPrivateId, setShowPrivateId] = useState(false);

  // ── MFA enrollment (TOTP) ────────────────────────────────────────────────
  const [mfaPanelOpen, setMfaPanelOpen] = useState(false);
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaQR, setMfaQR] = useState(null);
  const [mfaSecret, setMfaSecret] = useState(null);
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaUnenrolling, setMfaUnenrolling] = useState(false);
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState(null); // array of plaintext codes shown once
  const [mfaCodesRemaining, setMfaCodesRemaining] = useState(null);
  const [mfaHasLegacyCodes, setMfaHasLegacyCodes] = useState(false);
  const [mfaRecoveryMode, setMfaRecoveryMode] = useState(false); // on login challenge screen
  const [mfaRecoveryInput, setMfaRecoveryInput] = useState("");
  const [mfaDisableConfirm, setMfaDisableConfirm] = useState(false);
  const [mfaDisableCode, setMfaDisableCode] = useState("");
  const [mfaDisableMethod, setMfaDisableMethod] = useState("totp"); // 'totp' | 'phone'
  const [mfaDisableMsg, setMfaDisableMsg] = useState(null);

  // ── MFA challenge (login flow) ───────────────────────────────────────────
  const [mfaChallengeScreen, setMfaChallengeScreen] = useState(false);
  const [mfaChallengeCode, setMfaChallengeCode] = useState("");
  const [mfaChallengeMsg, setMfaChallengeMsg] = useState(null);
  const [mfaChallengeLoading, setMfaChallengeLoading] = useState(false);
  const [mfaChallengeFactorId, setMfaChallengeFactorId] = useState(null);

  // ── Phone OTP enrollment ─────────────────────────────────────────────────
  const [phonePanelOpen, setPhonePanelOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpCode, setPhoneOtpCode] = useState("");
  const [phoneMsg, setPhoneMsg] = useState(null);

  return {
    // Login form
    authEmail, setAuthEmail, authPassword, setAuthPassword, showAuthPw, setShowAuthPw,
    authIsNew, setAuthIsNew, authRemember, setAuthRemember, authLoading, setAuthLoading,
    authMsg, setAuthMsg,
    // Login subscreens
    loginSubScreen, setLoginSubScreen, forgotPwEmail, setForgotPwEmail,
    forgotPrivateId, setForgotPrivateId, forgotLookupResult, setForgotLookupResult,
    // Preview gate
    showPreviewPin, setShowPreviewPin, previewPinInput, setPreviewPinInput,
    previewPinError, setPreviewPinError, isPreviewMode, setIsPreviewMode,
    // Password panel
    showPwProfile, setShowPwProfile, pwPanelOpen, setPwPanelOpen,
    pwNew, setPwNew, pwConfirm, setPwConfirm, pwMsg, setPwMsg,
    // Email panel
    emailPanelOpen, setEmailPanelOpen, newEmail, setNewEmail, emailMsg, setEmailMsg,
    showEmail, setShowEmail,
    // User identity
    myPublicId, setMyPublicId, myPrivateId, setMyPrivateId, showPrivateId, setShowPrivateId,
    // MFA enrollment
    mfaPanelOpen, setMfaPanelOpen, mfaEnrolling, setMfaEnrolling,
    mfaQR, setMfaQR, mfaSecret, setMfaSecret, mfaFactorId, setMfaFactorId,
    mfaCode, setMfaCode, mfaMsg, setMfaMsg, mfaEnabled, setMfaEnabled,
    mfaUnenrolling, setMfaUnenrolling, mfaRecoveryCodes, setMfaRecoveryCodes,
    mfaCodesRemaining, setMfaCodesRemaining, mfaHasLegacyCodes, setMfaHasLegacyCodes,
    mfaRecoveryMode, setMfaRecoveryMode, mfaRecoveryInput, setMfaRecoveryInput,
    mfaDisableConfirm, setMfaDisableConfirm, mfaDisableCode, setMfaDisableCode,
    mfaDisableMethod, setMfaDisableMethod, mfaDisableMsg, setMfaDisableMsg,
    // MFA challenge
    mfaChallengeScreen, setMfaChallengeScreen, mfaChallengeCode, setMfaChallengeCode,
    mfaChallengeMsg, setMfaChallengeMsg, mfaChallengeLoading, setMfaChallengeLoading,
    mfaChallengeFactorId, setMfaChallengeFactorId,
    // Phone OTP
    phonePanelOpen, setPhonePanelOpen, phoneInput, setPhoneInput,
    phoneOtpSent, setPhoneOtpSent, phoneOtpCode, setPhoneOtpCode, phoneMsg, setPhoneMsg,
  };
}
