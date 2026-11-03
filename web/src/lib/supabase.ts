import { createClient } from '@supabase/supabase-js';
import type { WebConfig } from '../config';
export function createBrowserAuthClient(config: WebConfig) {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
