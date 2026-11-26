function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function hashPassword(password: string, existingSaltB64?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = existingSaltB64
    ? fromBase64(existingSaltB64)
    : crypto.getRandomValues(new Uint8Array(16));
  const saltBuffer = new Uint8Array(saltBytes).buffer;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 120000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return {
    hash: toBase64(new Uint8Array(derived)),
    salt: toBase64(saltBytes),
  };
}

export async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const { hash } = await hashPassword(password, storedSalt);
  if (hash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function generateTempPassword(length = 14): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const values = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += charset[values[i] % charset.length];
  }
  return out;
}
