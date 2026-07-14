import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Parâmetros OWASP para Argon2id (specs/03-auth.md).
// `Algorithm` é um const enum (não pode ser referenciado em valor com
// isolatedModules); 2 == Algorithm.Argon2id na definição do pacote.
const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  // Os parâmetros usados no hash ficam codificados na própria string PHC;
  // não é necessário (nem correto) repassar ARGON2_OPTIONS aqui.
  return verify(hashed, password);
}
