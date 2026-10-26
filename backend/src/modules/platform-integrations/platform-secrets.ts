import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function encryptionKey(): Buffer {
  const raw = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('PLATFORM_CONFIG_ENCRYPTION_KEY deve conter 32 bytes em hexadecimal');
  }
  return Buffer.from(raw, 'hex');
}

export function encryptPlatformSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptPlatformSecret(value: string): string {
  const [version, iv, authTag, encrypted] = value.split(':');
  if (version !== 'v1' || !iv || !authTag || encrypted === undefined) {
    throw new Error('Credencial de plataforma inválida');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()]).toString('utf8');
}

export function hashPlatformToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
