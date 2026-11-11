import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { keyFile } from '../identities.mjs';

test('a verified, permitted gate-out advances the note once', { timeout: 20_000 }, async context => {
  const setup = spawnSync(process.execPath, ['setup.mjs'], { encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);

  const server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, ECMR_DEMO_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => server.kill());
  let logs = '';
  server.stderr.on('data', chunk => { logs += chunk; });
  const base = await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.on('exit', code => reject(new Error(`Receiver exited with ${code}. ${logs}`)));
    let output = '';
    server.stdout.on('data', chunk => {
      output += chunk;
      const address = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (address) resolve(address[1]);
    });
  });

  const event = JSON.parse(readFileSync(new URL('../case/event.json', import.meta.url), 'utf8'));
  async function post(keyId, message, body = JSON.stringify(message)) {
    const bytes = Buffer.from(JSON.stringify(message));
    const signature = sign(null, bytes, readFileSync(keyFile(keyId, 'private')));
    const response = await fetch(base + '/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Key-Id': keyId,
        'X-Demo-Signature': signature.toString('base64url'),
      },
      body,
    });
    return { status: response.status, data: await response.json() };
  }
  const state = async () => (await fetch(base + '/state')).json();

  const wrongSender = await post('terminal-b', event);
  assert.equal(wrongSender.status, 403, JSON.stringify(wrongSender.data));
  assert.equal(wrongSender.data.check, 'ODRL');
  assert.equal(wrongSender.data.checks.shape, 'conforms');
  assert.equal(wrongSender.data.checks.odrl.decision, 'deny');

  const incomplete = await post('terminal-a', { ...event, receiptRef: undefined });
  assert.equal(incomplete.status, 422, JSON.stringify(incomplete.data));
  assert.ok(incomplete.data.issues.some(issue => issue.field === 'receiptRef'));

  const altered = await post('terminal-a', event, JSON.stringify({ ...event, receiptRef: 'changed' }));
  assert.equal(altered.status, 401);

  const otherVisit = await post('terminal-a', { ...event, visitId: 'TV-999' });
  assert.equal(otherVisit.status, 422);
  assert.equal(otherVisit.data.check, 'correlation');
  assert.equal((await state()).state, 'assigned');
  assert.equal((await state()).history.length, 0);

  const parallel = await Promise.all([post('terminal-a', event), post('terminal-a', event)]);
  assert.deepEqual(parallel.map(item => item.status), [200, 200], JSON.stringify(parallel));
  assert.deepEqual(parallel.map(item => item.data.outcome).sort(), ['accepted', 'duplicate']);

  const conflict = await post('terminal-a', { ...event, receiptRef: event.receiptRef + '-other' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.check, 'event ID conflict');

  const late = await post('terminal-a', { ...event, id: event.id + '-new' });
  assert.equal(late.status, 409);
  assert.equal(late.data.check, 'prior state');

  const final = await state();
  assert.equal(final.state, 'taken_over');
  assert.equal(final.evidence.receiptRef, event.receiptRef);
  assert.equal(final.history.length, 1);
});
