export interface WebConfig { supabaseUrl: string; publishableKey: string; apiUrl: string }
export function readWebConfig(env: Record<string, unknown>): WebConfig {
  const url = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Complete the public frontend configuration in web/.env.');
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password || value.includes('*')) throw new Error();
      return value;
    } catch { throw new Error('Frontend configuration requires exact HTTP(S) origins without credentials or paths.'); }
  };
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !key) throw new Error('Complete the public frontend configuration in web/.env.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key in frontend configuration.');
  return { supabaseUrl: url(env.VITE_SUPABASE_URL), publishableKey: key, apiUrl: url(env.VITE_FINSIGHT_API_URL) };
}
