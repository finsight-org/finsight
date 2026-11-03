import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('production assets embed only the three explicit public configuration values', () => {
  const output = mkdtempSync(join(tmpdir(), 'finsight-public-build-'));
  const canary = 'UNRELATED_ENV_MUST_NEVER_REACH_BROWSER_57ef';
  try {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', output], {
      cwd: process.cwd(), stdio: 'pipe', env: { ...process.env,
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build_test',
        VITE_FINSIGHT_API_URL: 'http://127.0.0.1:4001', VITE_UNRELATED_REVIEW_CANARY: canary },
    });
    const assets = readdirSync(join(output, 'assets')).filter(file => file.endsWith('.js'))
      .map(file => readFileSync(join(output, 'assets', file), 'utf8')).join('\n');
    expect(assets.includes(canary), 'Unrelated VITE_ environment value leaked into assets').toBe(false);
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 20_000);
