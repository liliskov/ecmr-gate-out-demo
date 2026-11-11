import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { keyDirectory, keyFile, testOrganisations } from './identities.mjs';

mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });

for (const keyId of Object.keys(testOrganisations)) {
  const privateKeyFile = keyFile(keyId, 'private');
  if (!existsSync(privateKeyFile)) {
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  const publicKey = createPublicKey(readFileSync(privateKeyFile));
  writeFileSync(keyFile(keyId, 'public'), publicKey.export({ type: 'spki', format: 'pem' }));
}

console.log('Local test keys are ready for Terminal A and Terminal B.');
