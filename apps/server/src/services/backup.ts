import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
const backupSchema = z.object({
  format: z.literal('receptly-backup-v1'),
  createdAt: z.string(),
  database: z.record(z.string(), z.unknown()),
  sessions: z.array(
    z.object({
      directory: z.string().regex(/^(?:user|payment)_[a-f0-9]{64}$/),
      name: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (name) => name !== '.' && name !== '..' && !/[/\\\x00-\x1f]/.test(name),
          'Use a file name without path separators.',
        ),
      contents: z.string(),
    }),
  ),
});
export type Backup = z.infer<typeof backupSchema>;
const magic = Buffer.from('RECEPTLY1');
function encryptionKey(hex: string) {
  if (!/^[a-f0-9]{64}$/i.test(hex))
    throw new Error('BACKUP_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  return Buffer.from(hex, 'hex');
}
export function encryptBackup(data: Backup, hexKey: string) {
  backupSchema.parse(data);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(hexKey), nonce);
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}
export function decryptBackup(blob: Buffer, hexKey: string): Backup {
  if (blob.length < magic.length + 28 || !blob.subarray(0, magic.length).equals(magic))
    throw new Error('Unsupported backup format.');
  const offset = magic.length;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(hexKey),
    blob.subarray(offset, offset + 12),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(blob.subarray(offset + 12, offset + 28));
  let data: unknown;
  try {
    data = JSON.parse(
      Buffer.concat([decipher.update(blob.subarray(offset + 28)), decipher.final()]).toString(),
    );
  } catch {
    throw new Error('Backup integrity check failed. Check the key and backup file.');
  }
  return backupSchema.parse(data);
}
