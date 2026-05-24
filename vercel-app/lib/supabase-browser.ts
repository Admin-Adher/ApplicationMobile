'use client';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'https://jzeojdpgglbxjdasjgta.supabase.co';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6ZW9qZHBnZ2xieGpkYXNqZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjg1ODAsImV4cCI6MjA5MDQwNDU4MH0.ZcU5EAYQMEnQHVe0-6Wff_1sBanvjtdZZ0hJNJGLAz0';

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
