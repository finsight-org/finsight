import { expect, test } from 'vitest';
import { readWebConfig } from '../src/config';
const env = { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', VITE_FINSIGHT_API_URL: 'http://127.0.0.1:4001' };
test('public configuration validates URLs and never accepts a privileged key', () => {
  expect(readWebConfig(env)).toEqual({ supabaseUrl: env.VITE_SUPABASE_URL, publishableKey: 'sb_publishable_test', apiUrl: env.VITE_FINSIGHT_API_URL });
  expect(() => readWebConfig({})).toThrow(/configuration/i);
  for (const key of ['sb_secret_private', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature']) {
    expect(() => readWebConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(/publishable/i);
  }
  for (const url of ['file:///tmp', 'http://user:password@localhost:4000', 'http://localhost:4000/path']) {
    expect(() => readWebConfig({ ...env, VITE_FINSIGHT_API_URL: url })).toThrow();
  }
});
