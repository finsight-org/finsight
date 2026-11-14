import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

// Never interpolate the operator's .env or inherited secrets into test output.
function compose(files: string[]) {
  return JSON.parse(execFileSync('docker', ['compose', '--env-file', '/dev/null', '--profile', 'web', ...files.flatMap(file => ['-f', file]), 'config', '--format', 'json'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME,
      SUPABASE_SECRET_KEY: 'sb_secret_SYNTHETIC', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_SYNTHETIC',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_SYNTHETIC' },
  }));
}

test('base Compose needs no session key, while opt-in sessions mount only a runtime read-only key', async () => {
  const base = compose(['compose.yaml']);
  const enabled = compose(['compose.yaml', 'compose.local-auth.yaml', 'compose.sessions.yaml']);
  assert.equal(base.services.finsight.environment.SUPABASE_SECRET_KEY, undefined);
  assert.equal(base.services.finsight.environment.FINSIGHT_SESSION_ENCRYPTION_KEY_FILE, undefined);
  assert.equal(base.services.finsight.volumes, undefined);
  const service = enabled.services.finsight;
  assert.equal(service.environment.SUPABASE_SECRET_KEY, 'sb_secret_SYNTHETIC');
  assert.equal(service.environment.FINSIGHT_SESSION_ENCRYPTION_KEY_FILE, '/run/secrets/finsight_session_key');
  assert.deepEqual(service.volumes.map((v: { target: string; read_only: boolean; source: string }) => ({
    target: v.target, readOnly: v.read_only, source: v.source.split('/').slice(-2).join('/'),
  })), [{ target: '/run/secrets/finsight_session_key', readOnly: true, source: '.secrets/finsight_session_key' }]);
  assert.equal(service.read_only, true);
  assert.equal(service.stop_grace_period, '10s');
  assert.equal(service.ports[0].host_ip, '127.0.0.1');
  assert.deepEqual(enabled.services.web.build.args, base.services.web.build.args);
  assert.doesNotMatch(JSON.stringify(enabled.services.web), /sb_secret_|FINSIGHT_SESSION/);
});
