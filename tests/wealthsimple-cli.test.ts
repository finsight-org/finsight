import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWealthsimple, type ConnectionIO } from '../src/cli/wealthsimple.js';
import { credentials, fixture, respond, tokens } from './wealthsimple-fixtures.js';

function terminal(answers: string[] = []) {
  const prompts: { label: string; hidden: boolean }[] = [];
  const output: string[] = [];
  const io: ConnectionIO = {
    prompt: async (label, hidden) => {
      prompts.push({ label, hidden });
      const answer = answers.shift();
      if (answer === undefined) throw new Error('Unexpected prompt');
      return answer;
    },
    write: message => { output.push(message); },
  };
  return { io, prompts, output };
}

test('terminal helper connects, reports status, and disconnects against real routes', async t => {
  const f = await fixture(t);
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const term = terminal([credentials.email, credentials.password]);
  const run = (command: string) => runWealthsimple([command, '--url', address], term.io);
  assert.equal(await run('status'), 0);
  assert.match(term.output.at(-1)!, /disconnected/);
  assert.equal(await run('login'), 0);
  assert.equal(await run('status'), 0);
  assert.match(term.output.at(-1)!, /connected/);
  assert.deepEqual(term.prompts, [{ label: 'Email: ', hidden: false }, { label: 'Password: ', hidden: true }]);
  assert.equal(f.calls.find(call => call.path === '/token')!.body.password, credentials.password);
  assert.equal(await run('disconnect'), 0);
  assert.equal(await run('status'), 0);
  assert.match(term.output.at(-1)!, /disconnected/);
  assert.doesNotMatch(term.output.join('\n'), /PASSWORD_SENTINEL|ACCESS_SENTINEL|person@example/);
});

test('terminal helper completes one MFA challenge sequentially without retaining credentials', async t => {
  const f = await fixture(t, { '/token': (call, _req, res) => {
    if (!call.headers['x-wealthsimple-otp']) respond(res, { error: 'invalid_grant' }, 400);
    else respond(res, tokens);
  } });
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const term = terminal([credentials.email, credentials.password, '123456']);
  assert.equal(await runWealthsimple(['login', '--url', address], term.io), 0);
  assert.deepEqual(term.prompts.map(prompt => prompt.hidden), [false, true, true]);
  const attempts = f.calls.filter(call => call.path === '/token');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].body.password, credentials.password);
  assert.equal(attempts[1].headers['x-wealthsimple-otp'], '123456;remember=true');
  assert.equal(await runWealthsimple(['login', '--url', address], term.io), 1);
  assert.equal(f.calls.filter(call => call.path === '/token').length, 2);
  assert.doesNotMatch(term.output.join('\n'), /PASSWORD_SENTINEL|123456/);
});

test('terminal helper does not retry rejected authentication or print diagnostics', async () => {
  for (const response of [
    Response.json({ error: { message: 'PASSWORD_SENTINEL' } }, { status: 401 }),
    Response.json({ status: 'PASSWORD_SENTINEL' }),
    new Response('PASSWORD_SENTINEL'.repeat(2000)),
  ]) {
    const term = terminal([credentials.email, credentials.password]);
    let requests = 0;
    term.io.fetch = async () => { requests++; return response; };
    assert.equal(await runWealthsimple(['login'], term.io), 1);
    assert.equal(requests, 1);
    assert.doesNotMatch(term.output.join('\n'), /PASSWORD_SENTINEL/);
  }
  const term = terminal([credentials.email, credentials.password, '123456']);
  let requests = 0;
  term.io.fetch = async () => { requests++; return Response.json({ status: 'mfa_required' }); };
  assert.equal(await runWealthsimple(['login'], term.io), 1);
  assert.equal(requests, 2);
});

test('terminal helper rejects secret arguments and invalid URLs before prompting', async () => {
  for (const args of [
    [], ['login', '--password', 'PASSWORD_SENTINEL'], ['login', '--otp', '123456'],
    ['login', '--url'], ['status', '--url', 'file:///tmp/test'],
    ['login', '--url', 'http://user:PASSWORD_SENTINEL@localhost:4000'],
    ['login', '--url', 'http://localhost:4000/path'], ['login', '--url', 'http://localhost:4000?password=PASSWORD_SENTINEL'],
  ]) {
    const term = terminal();
    assert.equal(await runWealthsimple(args, term.io), 1);
    assert.equal(term.prompts.length, 0);
    assert.doesNotMatch(term.output.join('\n'), /PASSWORD_SENTINEL|123456/);
  }
});

test('terminal helper handles unavailable servers and interruption safely', async () => {
  const term = terminal();
  term.io.fetch = async () => { throw new Error('PASSWORD_SENTINEL'); };
  assert.equal(await runWealthsimple(['status'], term.io), 1);
  assert.doesNotMatch(term.output.join('\n'), /PASSWORD_SENTINEL/);
  const controller = new AbortController();
  term.io.signal = controller.signal;
  term.io.prompt = async () => { controller.abort(); throw new Error('Interrupted'); };
  assert.equal(await runWealthsimple(['login'], term.io), 130);
  assert.equal(term.output.at(-1), 'Cancelled.');
});
