'use client';

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from './supabase-public-config';
import { createPostgrestReadFetch } from './postgrest-read-fetch';

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
  // Secondary GET/HEAD reads also have a deadline; writes/auth keep their transport.
  global: { fetch: createPostgrestReadFetch((input, init) => fetch(input, init)) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
