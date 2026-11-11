import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { keyFile, testOrganisations } from './identities.mjs';
import { authorise, validateEvent } from './rules.mjs';

const model = JSON.parse(readFileSync(new URL('./case/model.json', import.meta.url), 'utf8'));
const trustedKeys = new Map(Object.entries(testOrganisations).map(([keyId, organisation]) => [
  keyId,
  { organisation, publicKey: createPublicKey(readFileSync(keyFile(keyId, 'public'))) },
]));
const port = Number(process.env.ECMR_DEMO_PORT ?? 8787);
const acceptedEvents = new Map();
let note = {
  id: model.instanceId,
  ...model.correlation,
  state: model.transition.from,
  evidence: null,
  history: [],
};

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data, null, 2) + '\n');
}

async function receiveEvent(request, response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16_384) {
      request.resume();
      return sendJson(response, 413, { outcome: 'rejected', reason: 'The event exceeds 16 KiB.' });
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const sender = trustedKeys.get(request.headers['x-demo-key-id']);
  const signature = request.headers['x-demo-signature'];
  if (!sender || typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)
      || !verify(null, bytes, sender.publicKey, Buffer.from(signature, 'base64url'))) {
    return sendJson(response, 401, { outcome: 'rejected', check: 'identity', reason: 'Signature verification failed.' });
  }

  const checks = { identity: sender.organisation };
  let event;
  try {
    event = JSON.parse(bytes.toString('utf8'));
  } catch {
    return sendJson(response, 400, { outcome: 'rejected', checks, reason: 'Expected a JSON event.' });
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return sendJson(response, 400, { outcome: 'rejected', checks, reason: 'Expected a JSON object.' });
  }

  const issues = await validateEvent(event, model.datatypes);
  if (issues.length) {
    return sendJson(response, 422, { outcome: 'rejected', check: 'SHACL', checks, issues });
  }
  checks.shape = 'conforms';
  if (event.audience !== model.receiver) {
    return sendJson(response, 403, { outcome: 'denied', check: 'audience', checks });
  }
  if (!Object.entries(model.correlation).every(([field, expected]) => event[field] === expected)) {
    return sendJson(response, 422, { outcome: 'rejected', check: 'correlation', checks });
  }
  checks.correlation = model.instanceId;

  checks.odrl = await authorise(sender.organisation, model.target);
  if (checks.odrl.decision !== 'permit') {
    return sendJson(response, 403, { outcome: 'denied', check: 'ODRL', checks });
  }

  // All async checks have completed. Read and update the state in one synchronous step.
  const digest = createHash('sha256').update(bytes).digest('hex');
  const previous = acceptedEvents.get(event.id);
  if (previous) {
    if (previous.digest !== digest || previous.sender !== sender.organisation) {
      return sendJson(response, 409, { outcome: 'rejected', check: 'event ID conflict', checks });
    }
    return sendJson(response, 200, { outcome: 'duplicate', checks, note });
  }
  if (note.state !== model.transition.from) {
    return sendJson(response, 409, { outcome: 'rejected', check: 'prior state', checks, state: note.state });
  }

  note = {
    ...note,
    state: model.transition.to,
    evidence: Object.fromEntries(model.evidenceFields.map(field => [field, event[field]])),
    history: [...note.history, {
      eventId: event.id,
      sender: sender.organisation,
      from: model.transition.from,
      to: model.transition.to,
    }],
  };
  acceptedEvents.set(event.id, { digest, sender: sender.organisation });
  return sendJson(response, 200, { outcome: 'accepted', checks, note });
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/state') {
      return sendJson(response, 200, note);
    }
    if (request.method === 'POST' && request.url === '/events') {
      return await receiveEvent(request, response);
    }
    return sendJson(response, 404, { reason: 'Use POST /events or GET /state.' });
  } catch (error) {
    console.error('Processing error:', error.message);
    if (!response.headersSent && !response.destroyed) {
      sendJson(response, 500, { outcome: 'rejected', reason: 'Evaluation could not complete.' });
    }
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`eCMR provider listening on http://127.0.0.1:${server.address().port}`);
  console.log(`${note.id} is ${note.state}. Send a terminal event from a second terminal.`);
});
