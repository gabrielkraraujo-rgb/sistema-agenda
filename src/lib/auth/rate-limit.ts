// Rate limit de login em memória (instância única do processo) —
// specs/03-auth.md: janela deslizante, máx. 10 tentativas falhas por 15 min,
// chave `login:${ip}`. Entradas expiradas são limpas a cada verificação.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_ATTEMPTS = 10;

/** Timestamps (ms) das tentativas falhas recentes, por chave. */
const attempts = new Map<string, number[]>();

function prune(key: string, now: number): number[] {
  const list = attempts.get(key) ?? [];
  const fresh = list.filter((ts) => now - ts < WINDOW_MS);
  if (fresh.length > 0) {
    attempts.set(key, fresh);
  } else {
    attempts.delete(key);
  }
  return fresh;
}

/** Limpa toda entrada expirada do mapa (chamado a cada verificação). */
function pruneAll(now: number): void {
  for (const key of attempts.keys()) {
    prune(key, now);
  }
}

/** true se a chave já excedeu o limite de tentativas falhas na janela atual. */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  pruneAll(now);
  const fresh = prune(key, now);
  return fresh.length >= MAX_ATTEMPTS;
}

/** Registra uma tentativa de login falha para a chave (ex.: `login:${ip}`). */
export function registerFailedAttempt(key: string): void {
  const now = Date.now();
  const fresh = prune(key, now);
  fresh.push(now);
  attempts.set(key, fresh);
}

/** Limpa as tentativas da chave (ex.: após login bem-sucedido). */
export function clearAttempts(key: string): void {
  attempts.delete(key);
}

/**
 * IP do cliente: ÚLTIMO valor de `x-forwarded-for` — é o único anexado pelo
 * proxy confiável (Railway); os anteriores vêm do próprio cliente e
 * permitiriam contornar o rate limit rotacionando o header. Fallback `"local"`.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "local";
}

export function loginRateLimitKey(ip: string): string {
  return `login:${ip}`;
}

/** Limite adicional por conta — independe do IP (anti-rotação de header). */
export function accountRateLimitKey(email: string): string {
  return `login-account:${email.trim().toLowerCase()}`;
}
