import { createClient } from '@supabase/supabase-js';

// Config resolution — fail loud in production, warn loudly in dev.
//
// These used to fall back to the hardcoded live project silently, so a fork, a
// misconfigured CI job, or a deploy with missing env vars would read and WRITE
// the production database while appearing healthy. The anon key is public by
// design and RLS is the real boundary, but pointing the wrong DEPLOY at real
// user data is not something to discover later — so a production build now
// refuses to start without explicit config.
//
// Dev keeps the fallback (the repo has never shipped a .env and every local
// workflow depends on it) but says so on every boot.
const DEV_FALLBACK_URL = "https://tczqtwxrnptgajxwynmg.supabase.co";
const DEV_FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenF0d3hybnB0Z2FqeHd5bm1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjQxNjIsImV4cCI6MjA4OTAwMDE2Mn0.TqguHLUutoE2wbytDZ6xWFlp7Mk1W_ZMPYdXJkuCYjo";

const PLACEHOLDERS = new Set(["https://your-project.supabase.co", "your-anon-key"]);

function resolve(name, value, fallback) {
  const missing = !value || PLACEHOLDERS.has(value);
  if (!missing) return value;
  if (import.meta.env.PROD) {
    throw new Error(
      `[config] ${name} is missing or still set to the .env.example placeholder. ` +
      `Production builds must supply Supabase config explicitly — refusing to ` +
      `fall back to the shared project.`
    );
  }
  console.warn(
    `[config] ${name} not set — falling back to the shared dev Supabase project. ` +
    `This writes to REAL data. Copy .env.example to .env to point somewhere else.`
  );
  return fallback;
}

const sb = createClient(
  resolve("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL, DEV_FALLBACK_URL),
  resolve("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY, DEV_FALLBACK_ANON_KEY),
  { auth: { experimental: { passkey: true } } }
);

export { sb };
