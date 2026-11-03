import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startLocalSupabase } from '../scripts/start-supabase.js';

const bindingKey = 'com.docker.network.bridge.host_binding_ipv4';
function fixture({ existingNetwork = false, unsafeNetwork = false, unsafeRunning = false, unsafeAfterStart = false } = {}) {
  const calls: string[][] = []; let started = false;
  const run = (command: string, args: readonly string[]) => {
    calls.push([command, ...args]);
    if (command === 'docker' && args[0] === 'network' && args[1] === 'inspect') return { status: existingNetwork ? 0 : 1, stdout: JSON.stringify([{ Options: { [bindingKey]: unsafeNetwork ? '0.0.0.0' : '127.0.0.1' } }]) };
    if (command === 'docker' && args[0] === 'inspect') {
      const present = started || unsafeRunning;
      const ip = started ? (unsafeAfterStart ? '0.0.0.0' : '127.0.0.1') : '0.0.0.0';
      return { status: present ? 0 : 1, stdout: JSON.stringify(present ? [1,2,3].map(() => ({ NetworkSettings: { Ports: { '80/tcp': [{ HostIp: ip, HostPort: '1234' }] } } })) : []) };
    }
    if (command === 'supabase' && args[0] === 'start') started = true;
    return { status: 0, stdout: 'PRIVATE_LOCAL_STATUS' };
  };
  return { calls, run };
}
test('local startup creates a loopback bridge and verifies effective service bindings', () => {
  const f = fixture(); startLocalSupabase(f.run);
  assert.ok(f.calls.some(c => c.join(' ') === 'docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 finsight-supabase-local'));
  assert.ok(f.calls.some(c => c.join(' ') === 'supabase start --network-id finsight-supabase-local'));
});
test('startup migrates only this project from public bindings and preserves its volumes', () => {
  const f = fixture({ existingNetwork: true, unsafeRunning: true }); startLocalSupabase(f.run);
  assert.ok(f.calls.some(c => c.join(' ') === 'supabase stop --project-id finsight'));
  assert.ok(!f.calls.some(c => c.includes('--all') || c.includes('--no-backup')));
});
test('unsafe existing networks fail before start and unsafe final bindings stop the project', () => {
  const network = fixture({ existingNetwork: true, unsafeNetwork: true });
  assert.throws(() => startLocalSupabase(network.run), /loopback/i);
  assert.ok(!network.calls.some(c => c[0] === 'supabase'));
  const bindings = fixture({ unsafeAfterStart: true });
  assert.throws(() => startLocalSupabase(bindings.run), /loopback/i);
  assert.deepEqual(bindings.calls.at(-1), ['supabase', 'stop', '--project-id', 'finsight']);
});
