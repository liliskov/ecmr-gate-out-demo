export const testOrganisations = {
  'terminal-a': 'urn:ecmr-demo:org:terminal-a',
  'terminal-b': 'urn:ecmr-demo:org:terminal-b',
};

export const keyDirectory = new URL('./.demo-keys/', import.meta.url);

export function keyFile(keyId, kind) {
  return new URL(`${keyId}.${kind}.pem`, keyDirectory);
}
