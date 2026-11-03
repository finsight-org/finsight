import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type Runner = (command: string, args: readonly string[]) => { status: number | null; stdout: string };
const network = 'finsight-supabase-local';
const bindingOption = 'com.docker.network.bridge.host_binding_ipv4';
const services = ['supabase_kong_finsight', 'supabase_db_finsight', 'supabase_inbucket_finsight'];
type Container = { NetworkSettings?: { Ports?: Record<string, { HostIp?: string }[] | null> } };
function containers(stdout: string): Container[] {
  try { const parsed: unknown = JSON.parse(stdout); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function loopback(items: Container[]): boolean {
  return items.length === services.length && items.every(item => {
    const published = Object.values(item.NetworkSettings?.Ports ?? {}).flatMap(value => value ?? []);
    return published.length > 0 && published.every(binding => binding.HostIp === '127.0.0.1');
  });
}
const execute: Runner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' });
  // CLI status/start output includes local keys. Do not print it or Docker inspect output.
  return { status: result.status, stdout: result.stdout ?? '' };
};
export function startLocalSupabase(run: Runner = execute): void {
  const checked = (command: string, args: readonly string[]) => {
    const result = run(command, args);
    if (result.status !== 0) throw new Error(`Local Supabase setup failed while running ${command} ${args[0]}. Check Docker and the pinned CLI.`);
    return result;
  };
  const inspected = run('docker', ['network', 'inspect', network]);
  if (inspected.status === 0) {
    let options: Record<string, string> = {};
    try { options = JSON.parse(inspected.stdout)[0]?.Options ?? {}; } catch { /* fail closed below */ }
    if (options[bindingOption] !== '127.0.0.1') throw new Error('The existing local Auth network is not configured for loopback. Use a separate loopback network before starting.');
  } else checked('docker', ['network', 'create', '-o', `${bindingOption}=127.0.0.1`, network]);
  const running = containers(run('docker', ['inspect', ...services]).stdout);
  if (running.length && !loopback(running)) checked('supabase', ['stop', '--project-id', 'finsight']);
  checked('supabase', ['start', '--network-id', network]);
  if (!loopback(containers(run('docker', ['inspect', ...services]).stdout))) {
    checked('supabase', ['stop', '--project-id', 'finsight']);
    throw new Error('Local Auth services did not bind to loopback; this project was stopped.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startLocalSupabase(); console.log('Local Supabase is ready; API, database, and mail ports bind to 127.0.0.1.'); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Local Supabase startup failed.'); process.exitCode = 1; }
}
