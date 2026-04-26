import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://tczqtwxrnptgajxwynmg.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenF0d3hybnB0Z2FqeHd5bm1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjQxNjIsImV4cCI6MjA4OTAwMDE2Mn0.TqguHLUutoE2wbytDZ6xWFlp7Mk1W_ZMPYdXJkuCYjo";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { sb };
