import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('HTTPS Compose publishes only Caddy and builds a same-origin web app', () => {
  const host = 'finsight.example.test';
  const output = execFileSync('docker', [
    'compose', '-f', 'compose.yaml', '-f', 'compose.sessions.yaml', '-f', 'compose.https.yaml', 'config', '--format', 'json',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FINSIGHT_PUBLIC_HOST: host,
      SUPABASE_DOCKER_URL: 'https://auth.example.test',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      SUPABASE_SECRET_KEY: 'sb_secret_fixture',
      VITE_FINSIGHT_MCP_CLIENT_IDS: 'fd56dafb-3d59-4688-a9a9-cb4e17a65939',
    },
  });
  const { services } = JSON.parse(output);
  assert.deepEqual(Object.keys(services).sort(), ['caddy', 'finsight', 'web']);
  assert.equal(services.finsight.environment.FINSIGHT_PUBLIC_HOST, host);
  assert.equal(services.finsight.environment.WEB_ORIGINS, 'https://' + host);
  assert.equal(services.web.build.args.VITE_FINSIGHT_API_URL, 'https://' + host);
  assert.equal(services.web.build.args.VITE_SUPABASE_URL, 'https://auth.example.test');
  assert.equal(services.finsight.ports, undefined);
  assert.equal(services.web.ports, undefined);
  assert.deepEqual(services.caddy.ports.map((port: { target: number }) => port.target), [80, 443]);
  assert.doesNotMatch(JSON.stringify(services.web), /sb_secret_fixture/);
});
