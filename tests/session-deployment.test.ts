import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { readSessionConfig } from '../src/sessions/config.js';

test('deployment accepts absent or complete sessions and rejects partial configuration', async () => {
  assert.equal(await readSessionConfig({}, false), undefined);
  const complete = { SUPABASE_SECRET_KEY: 'sb_secret_SYNTHETIC', FINSIGHT_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64') };
  assert.ok(await readSessionConfig(complete, true));
  for (const partial of [{ SUPABASE_SECRET_KEY: complete.SUPABASE_SECRET_KEY }, { FINSIGHT_SESSION_ENCRYPTION_KEY: complete.FINSIGHT_SESSION_ENCRYPTION_KEY }]) {
    await assert.rejects(readSessionConfig(partial, true), { code: 'SESSION_NOT_CONFIGURED' });
  }
});

test('images allowlist source and keep runtime secrets out of COPY and frontend inputs', async () => {
  const [dockerfile, ignore, env] = await Promise.all(['Dockerfile', '.dockerignore', '.env.example'].map(path => readFile(path, 'utf8')));
  assert.match(dockerfile, /^USER node$/m);
  const copies = dockerfile.split('\n').filter(line => line.startsWith('COPY '));
  for (const copy of copies) assert.doesNotMatch(copy, /\.secrets|\.env|COPY \. |COPY \.\//);
  assert.equal(ignore.split('\n')[0], '**');
  assert.doesNotMatch(ignore, /!\.secrets|!\.env/);
  assert.match(env, /^SUPABASE_SECRET_KEY=$/m);
  assert.match(env, /^FINSIGHT_SESSION_ENCRYPTION_KEY=$/m);
  assert.match(env, /^FINSIGHT_SESSION_ENCRYPTION_KEY_FILE=$/m);
  assert.doesNotMatch(env, /^VITE_.*(?:SECRET|SESSION_ENCRYPTION)/m);
});
