// Maps notifications-outbox rows → email subject + HTML. Consumed by the
// notifications-drain scheduled function. Event types with no entry here are
// in-app-only and get marked 'skipped' for the email channel.
//
// Keep the copy in the same voice as src/features/notifications/
// notificationTypes.js (the in-app renderings of the same events).

import { renderEmail, cardBody, escapeHtml } from "./emailTemplate.js";

const APP_URL = "https://aurisargames.com";
const FOOTER = "You can turn these emails off in Profile → Notification Preferences.";

// Per-event sender. Welcome mail keeps the established welcome@ identity it
// had when it was sent directly, so retiring that path is not a brand or
// deliverability regression; everything else ships from notifications@.
const DEFAULT_FROM = "Aurisar Fitness <notifications@aurisargames.com>";
const FROM_BY_EVENT = {
  welcome: "Aurisar Fitness <welcome@aurisargames.com>",
};

export function fromAddressFor(eventType) {
  return FROM_BY_EVENT[eventType] || DEFAULT_FROM;
}

const RENDERERS = {
  friend_level_up(p) {
    const name = escapeHtml(p.playerName || "A friend");
    const lvl = Number(p.newLevel) || "?";
    return {
      subject: `${p.playerName || "A friend"} reached Level ${lvl} on Aurisar`,
      html: renderEmail({
        title: "Friend level up",
        bodyHtml: cardBody(
          `⬆️ ${name} leveled up!`,
          [
            `<strong style="color:#c49428">${name}</strong> just reached <strong style="color:#d4cec4">Level ${lvl}</strong>. The realm takes notice.`,
            `Think you can keep pace? Log a workout and close the gap.`,
          ]
        ),
        ctaText: "Enter the Realm",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  friend_request(p) {
    const name = escapeHtml(p.fromName || "Someone");
    return {
      subject: `${p.fromName || "Someone"} sent you a friend request on Aurisar`,
      html: renderEmail({
        title: "New friend request",
        bodyHtml: cardBody(`🤝 A challenger approaches`, [
          `<strong style="color:#c49428">${name}</strong> wants to join forces with you on Aurisar.`,
          `Accept the request to share workouts, compare PBs and keep each other honest.`,
        ]),
        ctaText: "View Request",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  friend_accepted(p) {
    const name = escapeHtml(p.friendName || "Someone");
    return {
      subject: `${p.friendName || "Someone"} accepted your friend request`,
      html: renderEmail({
        title: "Friend request accepted",
        bodyHtml: cardBody(`✅ Alliance forged`, [
          `<strong style="color:#c49428">${name}</strong> accepted your friend request. Your fellowship grows.`,
        ]),
        ctaText: "Enter the Realm",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  shared_workout(p) {
    const name = escapeHtml(p.fromName || "A friend");
    const workout = escapeHtml(p.workoutName || "a workout");
    return {
      subject: `${p.fromName || "A friend"} shared a workout with you`,
      html: renderEmail({
        title: "Workout shared",
        bodyHtml: cardBody(`📋 A scroll arrives`, [
          `<strong style="color:#c49428">${name}</strong> shared <strong style="color:#d4cec4">“${workout}”</strong> with you.`,
          `Open Aurisar to review it and add it to your plans.`,
        ]),
        ctaText: "View Workout",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  message_received(p) {
    const name = escapeHtml(p.fromName || "a friend");
    return {
      subject: `New message from ${p.fromName || "a friend"} on Aurisar`,
      html: renderEmail({
        title: "New message",
        bodyHtml: cardBody(`💬 A raven has arrived`, [
          `You have a new message from <strong style="color:#c49428">${name}</strong>.`,
          `Message contents stay in the app — open Aurisar to read and reply.`,
        ]),
        ctaText: "Read Message",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  streak_at_risk(p) {
    const streak = Number(p.streak) || 0;
    return {
      subject: streak
        ? `Your ${streak}-day streak is at risk`
        : "Your Aurisar streak is at risk",
      html: renderEmail({
        title: "Streak at risk",
        bodyHtml: cardBody(`🔥 The flame flickers`, [
          streak
            ? `Your <strong style="color:#d4cec4">${streak}-day</strong> check-in streak ends at midnight. One check-in keeps it alive.`
            : `Your check-in streak ends at midnight. One check-in keeps it alive.`,
        ]),
        ctaText: "Check In Now",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  workout_reminder(p) {
    return {
      subject: "Your training awaits on Aurisar",
      html: renderEmail({
        title: "Workout reminder",
        bodyHtml: cardBody(`⏰ The realm remembers the disciplined`, [
          escapeHtml(p.text || "You have training scheduled today. Your quest awaits."),
        ]),
        ctaText: "Start Training",
        ctaUrl: APP_URL,
        footerNote: FOOTER,
      }),
    };
  },

  welcome() {
    return {
      subject: "Welcome to Aurisar Fitness — Your Journey Begins",
      html: renderEmail({
        title: "Welcome to Aurisar Fitness",
        bodyHtml: cardBody("Welcome, Warrior.", [
          "Your account has been forged. The journey to elite fitness begins now.",
          "Complete your onboarding to unlock your warrior class, earn your first XP, and claim your place.",
        ]),
        ctaText: "Enter the Realm",
        ctaUrl: APP_URL,
        footerNote: "You're receiving this because you created an account at aurisargames.com",
      }),
    };
  },

  security_alert(p) {
    return {
      subject: "Security notice for your Aurisar account",
      html: renderEmail({
        title: "Security notice",
        bodyHtml: cardBody(`🛡️ Account security`, [
          escapeHtml(p.text || "A security-relevant change occurred on your account."),
          `If this was you, no action is needed. If not, reset your password immediately and contact support@aurisargames.com.`,
        ]),
        ctaText: "Review Account",
        ctaUrl: APP_URL,
        footerNote: "Security notices are always sent — they cannot be disabled.",
      }),
    };
  },
};

// → { subject, html } or null when the event type has no email rendering.
export function renderNotificationEmail(row) {
  const fn = RENDERERS[row.event_type];
  if (!fn) return null;
  return fn(row.payload || {});
}
