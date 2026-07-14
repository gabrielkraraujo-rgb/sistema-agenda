import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

// Criptografia de segredos em repouso (API keys, tokens OAuth) — AES-256-GCM.
// Formato do payload: iv.tag.cipher, cada parte em base64url.

function masterKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 64) {
    throw new Error("APP_SECRET ausente ou curta (esperado hex de 32 bytes)");
  }
  return Buffer.from(secret, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload
    .split(".")
    .map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
