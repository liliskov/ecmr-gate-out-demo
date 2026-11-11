import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keyFile } from './identities.mjs';

const scenario = process.argv[2] ?? 'valid';
const available = ['valid', 'wrong-sender', 'missing-receipt', 'tampered'];
if (!available.includes(scenario)) {
  console.error(`Choose a scenario: ${available.join(', ')}`);
  process.exit(1);
}

const event = JSON.parse(readFileSync(new URL('./case/event.json', import.meta.url), 'utf8'));
const keyId = scenario === 'wrong-sender' ? 'terminal-b' : 'terminal-a';
if (scenario === 'missing-receipt') delete event.receiptRef;

const originalBytes = Buffer.from(JSON.stringify(event));
const signature = sign(null, originalBytes, readFileSync(keyFile(keyId, 'private')));
const body = scenario === 'tampered'
  ? JSON.stringify({ ...event, receiptRef: event.receiptRef + '-changed' })
  : originalBytes;

const port = Number(process.env.ECMR_DEMO_PORT ?? 8787);
const response = await fetch(`http://127.0.0.1:${port}/events`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Demo-Key-Id': keyId,
    'X-Demo-Signature': signature.toString('base64url'),
  },
  body,
});

console.log(`Sent ${event.type} (${event.id}) as ${keyId}.`);
console.log(`HTTP ${response.status} · ${scenario}`);
console.log(await response.text());
