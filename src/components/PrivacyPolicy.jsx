import aurisarLogo from '../assets/aurisar-logo.png';

const EFFECTIVE_DATE = 'May 9, 2025';

const S = {
  page: {
    minHeight: '100vh',
    background: `
      radial-gradient(120% 100% at 70% 30%, oklch(0.22 0.04 75 / 0.4), transparent 55%),
      linear-gradient(180deg, oklch(0.10 0.008 60), oklch(0.06 0.005 60))
    `,
    color: 'oklch(0.82 0.015 75)',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '28px 48px 0',
    maxWidth: 860,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  logo: { width: 32, height: 32, objectFit: 'contain', opacity: 0.85 },
  wordmark: {
    fontFamily: "'Cinzel Decorative', serif",
    fontSize: 14,
    letterSpacing: '0.18em',
    color: 'oklch(0.72 0.08 75)',
    textTransform: 'uppercase',
  },
  backBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: '1px solid oklch(0.72 0.08 75 / 0.25)',
    borderRadius: 4,
    color: 'oklch(0.72 0.08 75)',
    fontSize: 12,
    padding: '6px 14px',
    cursor: 'pointer',
    letterSpacing: '0.06em',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  body: {
    maxWidth: 860,
    margin: '0 auto',
    padding: '40px 48px 80px',
    boxSizing: 'border-box',
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'oklch(0.62 0.10 75)',
    marginBottom: 12,
  },
  h1: {
    fontFamily: "'Cinzel Decorative', serif",
    fontSize: 'clamp(22px, 4vw, 34px)',
    fontWeight: 400,
    letterSpacing: '0.06em',
    color: 'oklch(0.92 0.02 75)',
    marginBottom: 8,
    lineHeight: 1.15,
  },
  meta: {
    fontSize: 12,
    color: 'oklch(0.52 0.01 75)',
    marginBottom: 40,
  },
  section: {
    marginBottom: 40,
  },
  h2: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'oklch(0.72 0.08 75)',
    marginBottom: 14,
    paddingBottom: 8,
    borderBottom: '1px solid oklch(0.72 0.08 75 / 0.15)',
  },
  p: {
    fontSize: 14.5,
    lineHeight: 1.75,
    color: 'oklch(0.75 0.012 75)',
    marginBottom: 14,
  },
  ul: {
    paddingLeft: 20,
    margin: '10px 0 14px',
  },
  li: {
    fontSize: 14.5,
    lineHeight: 1.7,
    color: 'oklch(0.75 0.012 75)',
    marginBottom: 6,
  },
  highlight: {
    background: 'oklch(0.62 0.10 75 / 0.10)',
    border: '1px solid oklch(0.62 0.10 75 / 0.20)',
    borderRadius: 6,
    padding: '14px 18px',
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 1.65,
    color: 'oklch(0.82 0.015 75)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13.5,
    marginBottom: 16,
  },
  th: {
    textAlign: 'left',
    padding: '9px 12px',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'oklch(0.62 0.08 75)',
    borderBottom: '1px solid oklch(0.72 0.08 75 / 0.20)',
  },
  td: {
    padding: '9px 12px',
    verticalAlign: 'top',
    borderBottom: '1px solid oklch(0.72 0.08 75 / 0.08)',
    color: 'oklch(0.75 0.012 75)',
    lineHeight: 1.5,
  },
  link: {
    color: 'oklch(0.72 0.10 75)',
    textDecoration: 'none',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid oklch(0.72 0.08 75 / 0.10)',
    margin: '40px 0',
  },
  contactCard: {
    background: 'oklch(0.14 0.008 60)',
    border: '1px solid oklch(0.72 0.08 75 / 0.12)',
    borderRadius: 8,
    padding: '20px 24px',
    marginTop: 8,
  },
};

function Section({ title, children }) {
  return (
    <section style={S.section}>
      <div style={S.h2}>{title}</div>
      {children}
    </section>
  );
}

function P({ children }) {
  return <p style={S.p}>{children}</p>;
}

function UL({ items }) {
  return (
    <ul style={S.ul}>
      {items.map((item, i) => (
        <li key={i} style={S.li}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPolicy() {
  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  }

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 860, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* ── Header ── */}
        <div style={S.header}>
          <img src={aurisarLogo} alt="Aurisar" style={S.logo} />
          <span style={S.wordmark}>Aurisar</span>
          <button onClick={goBack} style={S.backBtn} type="button">← Back</button>
        </div>

        {/* ── Body ── */}
        <div style={S.body}>
          <div style={S.eyebrow}>Legal · Privacy</div>
          <h1 style={S.h1}>Privacy Policy</h1>
          <div style={S.meta}>Effective date: {EFFECTIVE_DATE}</div>

          {/* TL;DR callout */}
          <div style={S.highlight}>
            <strong style={{ color: 'oklch(0.88 0.06 75)' }}>The short version:</strong> We collect only what's
            needed to run Aurisar. We do not sell your data, share it with advertisers, or
            use analytics tracking tools. Data you choose to remove is removed. If something
            must be stored, it's encrypted in transit and at rest.
          </div>

          <Section title="1. Who We Are">
            <P>
              Aurisar ("we," "our," or "us") is a fitness and role-playing game platform
              operated by Aurisar Games. We can be reached at{' '}
              <a href="mailto:support@aurisargames.com" style={S.link}>support@aurisargames.com</a>.
            </P>
            <P>
              This Privacy Policy explains what information we collect when you use
              aurisargames.com (the "Service"), how we use it, and your rights over it.
            </P>
          </Section>

          <Section title="2. Information We Collect">
            <P>We collect information in three ways: information you give us directly,
              information generated by your use of the Service, and (optionally) information
              from third-party services you choose to connect.</P>

            <div style={{ ...S.h2, fontSize: 11.5, marginTop: 18 }}>2a. Account &amp; Profile Data</div>
            <P>When you create an account, we collect:</P>
            <UL items={[
              'Email address — used to authenticate your account and send transactional emails (password resets, etc.)',
              'Username — the display name you choose for the world and leaderboard',
              'Avatar configuration — your chosen class, body type, appearance settings, and gear selections',
              'Fitness profile answers (age range, activity level, goals) gathered during onboarding — used only to personalise your experience',
            ]} />

            <div style={{ ...S.h2, fontSize: 11.5, marginTop: 18 }}>2b. Multiplayer Session Data (SpacetimeDB)</div>
            <P>
              While you're playing in the Aurisar world, we process your real-time position,
              movement state, and proximity chat messages so other players can see you.
              This data is <strong style={{ color: 'oklch(0.88 0.06 75)' }}>ephemeral</strong>:
              it exists only for the duration of your session and is not archived or
              associated with a persistent log.
            </P>

            <div style={{ ...S.h2, fontSize: 11.5, marginTop: 18 }}>2c. WHOOP Fitness Data (Optional — You Initiate This)</div>
            <P>
              If you choose to connect a WHOOP device, you will be taken through WHOOP's
              OAuth consent screen where you explicitly authorise us to read specific data.
              We request access to recovery scores, sleep metrics, workout summaries, and
              heart rate data. This data is stored in your account so Aurisar can
              display your stats and power in-game mechanics. You can disconnect WHOOP and
              request deletion of this data at any time by contacting us.
            </P>

            <div style={{ ...S.h2, fontSize: 11.5, marginTop: 18 }}>2d. Support &amp; Feedback Submissions</div>
            <P>
              When you submit a bug report or idea, we collect your message text and
              optionally your email address so we can follow up. Your email is used only to
              respond to your submission and is never added to a marketing list.
            </P>
          </Section>

          <Section title="3. How We Use Your Information">
            <P>We use your information <strong style={{ color: 'oklch(0.88 0.06 75)' }}>only to operate the Service</strong>. Specifically:</P>
            <UL items={[
              'Authenticate your account and keep it secure',
              'Sync your character, avatar, and workout progress across devices',
              'Enable real-time multiplayer features (seeing other players, proximity chat)',
              'Display your WHOOP recovery and fitness stats within the app (if connected)',
              'Respond to support requests you initiate',
              'Enforce rate limits and protect against abuse',
            ]} />
            <P>
              We do not use your data to build advertising profiles, train AI models,
              conduct market research for third parties, or any purpose beyond what is
              described here.
            </P>
          </Section>

          <Section title="4. What We Do NOT Do">
            <div style={S.highlight}>
              <UL items={[
                'We do not sell, rent, or trade your personal data — ever.',
                'We do not run advertising networks or share data with ad brokers.',
                'We do not use third-party analytics SDKs (no Google Analytics, Mixpanel, Amplitude, Meta Pixel, or similar tools).',
                'We do not fingerprint your device or track you across other websites.',
                'We do not retain session-level data (position, movement) beyond your active session.',
              ]} />
            </div>
          </Section>

          <Section title="5. Third-Party Services We Use">
            <P>
              We use a small number of infrastructure services to run Aurisar. Each receives
              only the data necessary for its specific function:
            </P>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Service</th>
                  <th style={S.th}>Purpose</th>
                  <th style={S.th}>Data Shared</th>
                  <th style={S.th}>Their Privacy Policy</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={S.td}><strong>Supabase</strong></td>
                  <td style={S.td}>Database &amp; authentication</td>
                  <td style={S.td}>Account data, avatar config, fitness data</td>
                  <td style={S.td}><a href="https://supabase.com/privacy" style={S.link} target="_blank" rel="noreferrer">supabase.com/privacy</a></td>
                </tr>
                <tr>
                  <td style={S.td}><strong>SpacetimeDB</strong></td>
                  <td style={S.td}>Real-time multiplayer</td>
                  <td style={S.td}>Session-only: username, position, movement</td>
                  <td style={S.td}><a href="https://spacetimedb.com/privacy" style={S.link} target="_blank" rel="noreferrer">spacetimedb.com/privacy</a></td>
                </tr>
                <tr>
                  <td style={S.td}><strong>WHOOP</strong></td>
                  <td style={S.td}>Fitness data integration</td>
                  <td style={S.td}>Only if you connect — authorised by you via OAuth</td>
                  <td style={S.td}><a href="https://www.whoop.com/privacy-policy/" style={S.link} target="_blank" rel="noreferrer">whoop.com/privacy-policy</a></td>
                </tr>
                <tr>
                  <td style={S.td}><strong>Resend</strong></td>
                  <td style={S.td}>Transactional email delivery</td>
                  <td style={S.td}>Your email address, support message content</td>
                  <td style={S.td}><a href="https://resend.com/legal/privacy-policy" style={S.link} target="_blank" rel="noreferrer">resend.com/legal/privacy-policy</a></td>
                </tr>
                <tr>
                  <td style={S.td}><strong>Cloudflare Turnstile</strong></td>
                  <td style={S.td}>Bot protection (CAPTCHA)</td>
                  <td style={S.td}>Challenge token only — no personal data retained by Cloudflare on our behalf</td>
                  <td style={S.td}><a href="https://www.cloudflare.com/privacypolicy/" style={S.link} target="_blank" rel="noreferrer">cloudflare.com/privacypolicy</a></td>
                </tr>
                <tr>
                  <td style={S.td}><strong>Netlify</strong></td>
                  <td style={S.td}>Hosting &amp; serverless functions</td>
                  <td style={S.td}>Standard web server logs (IP, request path)</td>
                  <td style={S.td}><a href="https://www.netlify.com/privacy/" style={S.link} target="_blank" rel="noreferrer">netlify.com/privacy</a></td>
                </tr>
              </tbody>
            </table>
            <P>
              None of these services receive your data for their own commercial purposes
              beyond the infrastructure function described above.
            </P>
          </Section>

          <Section title="6. Data Retention">
            <P>We hold your data for as long as your account exists or as long as needed to
              provide the Service. Specific retention rules:</P>
            <UL items={[
              'Account and profile data — retained while your account is active. Deleted within 30 days of a verified account deletion request.',
              'WHOOP fitness data — retained while you have WHOOP connected. You can disconnect at any time from your profile; data is deleted on request.',
              'Multiplayer session data — not retained beyond your active session.',
              'Support emails and feedback — retained for up to 24 months for operational purposes (bug tracking, follow-up).',
              'Server access logs (Netlify) — retained per Netlify\'s standard log retention policy (typically 30 days).',
            ]} />
          </Section>

          <Section title="7. Cookies &amp; Local Storage">
            <P>
              Aurisar does <strong style={{ color: 'oklch(0.88 0.06 75)' }}>not</strong> use
              advertising cookies or third-party tracking cookies. We use:
            </P>
            <UL items={[
              'Supabase authentication tokens — stored in browser memory by the Supabase SDK to keep you logged in. If you select "Remain logged in for 30 days," a refresh token is persisted securely.',
              'localStorage — used to cache your profile data for faster load times and offline resilience. This data is your own account data, not shared with anyone.',
              'sessionStorage — used during WHOOP OAuth to store a temporary state token for CSRF protection. Cleared immediately after authentication completes.',
            ]} />
          </Section>

          <Section title="8. Security">
            <P>We take reasonable technical and organisational measures to protect your data:</P>
            <UL items={[
              'All data is transmitted over HTTPS/TLS. WebSocket connections use WSS.',
              'Supabase encrypts data at rest. Row-Level Security policies ensure users can only access their own data.',
              'API endpoints enforce origin allowlists, per-IP rate limiting, and bot-protection challenges.',
              'WHOOP OAuth tokens are stored server-side and never exposed to the browser.',
              'Passwords are never stored by us — authentication is delegated to Supabase Auth, which uses bcrypt hashing.',
            ]} />
            <P>
              No system is perfectly secure. If you discover a security vulnerability, please
              disclose it responsibly to{' '}
              <a href="mailto:support@aurisargames.com" style={S.link}>support@aurisargames.com</a>.
            </P>
          </Section>

          <Section title="9. Your Rights">
            <P>You have the right to:</P>
            <UL items={[
              'Access — request a copy of the personal data we hold about you.',
              'Correction — ask us to correct inaccurate data.',
              'Deletion — request that we delete your account and associated data.',
              'Portability — request your data in a machine-readable format.',
              'Withdraw consent — disconnect WHOOP or other integrations at any time.',
            ]} />
            <P>
              To exercise any of these rights, email us at{' '}
              <a href="mailto:support@aurisargames.com" style={S.link}>support@aurisargames.com</a>.
              We will respond within 30 days.
            </P>
          </Section>

          <Section title="10. Children's Privacy">
            <P>
              Aurisar is not directed at children under 13. We do not knowingly collect
              personal information from anyone under 13. If you believe a child has provided
              us with personal data, please contact us and we will delete it promptly.
            </P>
          </Section>

          <Section title="11. Changes to This Policy">
            <P>
              We may update this Privacy Policy from time to time. When we do, we will update
              the effective date at the top of this page. For material changes, we will notify
              active users via an in-app notice or email. Continued use of the Service after
              changes are posted constitutes acceptance of the updated policy.
            </P>
          </Section>

          <hr style={S.divider} />

          <Section title="12. Contact Us">
            <P>Questions, data requests, or concerns about this policy:</P>
            <div style={S.contactCard}>
              <div style={{ fontSize: 14, color: 'oklch(0.85 0.02 75)', marginBottom: 4 }}>
                <strong>Aurisar Games</strong>
              </div>
              <a href="mailto:support@aurisargames.com" style={{ ...S.link, fontSize: 14 }}>
                support@aurisargames.com
              </a>
            </div>
          </Section>

          <div style={{ marginTop: 48, fontSize: 11, color: 'oklch(0.42 0.01 75)', textAlign: 'center', letterSpacing: '0.06em' }}>
            © {new Date().getFullYear()} Aurisar Games · All rights reserved ·{' '}
            <a href="/privacy" style={{ ...S.link, fontSize: 11, opacity: 0.7 }}>Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
}
