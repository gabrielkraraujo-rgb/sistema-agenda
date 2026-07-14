import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

// Sessão de usuário único — specs/03-auth.md.
// Token puro (32 bytes base64url) só existe no cookie do navegador; no banco
// guardamos apenas o sha256 hex do token (Session.id).

const COOKIE_NAME = "session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const SLIDING_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // renova se faltar menos que isso

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

// cookies().set/delete só são permitidos em Server Actions e Route Handlers.
// requireSession()/validateSession() também rodam durante a renderização de
// Server Components (páginas protegidas) — nesse contexto a escrita do
// cookie lançaria ReadonlyRequestCookiesError. A sessão no banco já foi
// atualizada; o cookie será refrescado na próxima Server Action.
function safeSetCookie(store: CookieStore, token: string, maxAgeMs: number) {
  try {
    store.set(COOKIE_NAME, token, cookieOptions(maxAgeMs));
  } catch {
    // Chamado a partir de um Server Component — ignorar silenciosamente.
  }
}

function safeDeleteCookie(store: CookieStore) {
  try {
    store.delete(COOKIE_NAME);
  } catch {
    // Chamado a partir de um Server Component — ignorar silenciosamente.
  }
}

/** Cria uma nova sessão para o usuário e grava o cookie `session`. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: { id: tokenHash, userId, expiresAt },
  });

  const store = await cookies();
  safeSetCookie(store, token, SESSION_DURATION_MS);
}

/**
 * Lê o cookie `session`, valida contra o banco e aplica expiração deslizante
 * (renova para +30 dias se faltar menos de 15 dias). Retorna `null` sem
 * lançar/redirecionar se a sessão for ausente ou inválida.
 */
export async function validateSession(): Promise<{ user: User } | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = sha256Hex(token);
  const session = await prisma.session.findUnique({
    where: { id: tokenHash },
    include: { user: true },
  });

  if (!session) {
    safeDeleteCookie(store);
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: tokenHash } }).catch(() => {});
    safeDeleteCookie(store);
    return null;
  }

  const remainingMs = session.expiresAt.getTime() - Date.now();
  if (remainingMs < SLIDING_THRESHOLD_MS) {
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await prisma.session.update({
      where: { id: tokenHash },
      data: { expiresAt: newExpiresAt },
    });
    safeSetCookie(store, token, SESSION_DURATION_MS);
  }

  return { user: session.user };
}

/** Apaga a sessão atual (banco + cookie). Usado no logout. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = sha256Hex(token);
    await prisma.session.delete({ where: { id: tokenHash } }).catch(() => {});
  }
  safeDeleteCookie(store);
}

/**
 * Garante uma sessão válida — usado no topo de toda server action e página
 * protegida. Redireciona para /login se a sessão estiver ausente/inválida.
 */
export async function requireSession(): Promise<{ user: User }> {
  const session = await validateSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/** Retorna o usuário autenticado (ou null) sem redirecionar. */
export async function getSessionUser(): Promise<User | null> {
  const session = await validateSession();
  return session?.user ?? null;
}

/**
 * Invalida todas as sessões do usuário, exceto a sessão atual (identificada
 * pelo cookie da requisição em curso). Usado ao trocar a senha.
 */
export async function invalidateOtherSessions(userId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  const currentSessionId = token ? sha256Hex(token) : null;

  await prisma.session.deleteMany({
    where: {
      userId,
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    },
  });
}
