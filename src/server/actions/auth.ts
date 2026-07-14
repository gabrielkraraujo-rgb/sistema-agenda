"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  destroySession,
  invalidateOtherSessions,
  requireSession,
} from "@/lib/auth/session";
import {
  accountRateLimitKey,
  getClientIp,
  isRateLimited,
  loginRateLimitKey,
  registerFailedAttempt,
  clearAttempts,
} from "@/lib/auth/rate-limit";
import type { ActionResult } from "@/lib/types";

// Mensagem de erro única para não vazar se o e-mail existe ou não —
// specs/03-auth.md.
const GENERIC_LOGIN_ERROR = "E-mail ou senha incorretos";

// No login o e-mail é apenas a chave de busca — validação estrita de formato
// (z.email()) rejeitaria endereços locais válidos como "admin@local" e
// bloquearia o próprio usuário seed. Basta ser uma string não vazia.
const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

// Hash Argon2id válido usado apenas para manter o tempo de verificação
// constante quando o e-mail informado não corresponde a nenhum usuário
// (evita vazar existência de conta por timing). Calculado uma única vez por
// processo, sob demanda.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(
      "dummy-password-usada-apenas-para-tempo-constante",
    );
  }
  return dummyHashPromise;
}

/** Server action de login — usar com `useActionState`. */
export async function login(
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  const { email, password } = parsed.data;

  const headersList = await headers();
  const ip = getClientIp(headersList);
  // Duas dimensões: por IP e por conta — a segunda segura brute-force mesmo
  // se o atacante rotacionar o x-forwarded-for (security-check F3).
  const ipKey = loginRateLimitKey(ip);
  const accountKey = accountRateLimitKey(email);

  if (isRateLimited(ipKey) || isRateLimited(accountKey)) {
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Sempre executa verifyPassword, mesmo se o usuário não existir, com um
  // hash dummy constante — evita vazar existência de conta por timing.
  const hashToVerify = user?.passwordHash ?? (await getDummyHash());
  const valid = await verifyPassword(hashToVerify, password);

  if (!user || !valid) {
    registerFailedAttempt(ipKey);
    registerFailedAttempt(accountKey);
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  clearAttempts(ipKey);
  clearAttempts(accountKey);
  await createSession(user.id);
  redirect("/");
}

/** Server action de logout. */
export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "A nova senha deve ter ao menos 8 caracteres"),
  });

/**
 * Troca a senha do usuário autenticado: verifica a senha atual, re-hash da
 * nova senha e invalida todas as outras sessões (mantém a atual).
 */
export async function changePassword(
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await requireSession();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Dados inválidos";
    return { ok: false, error: message };
  }

  const { currentPassword, newPassword } = parsed.data;

  const currentUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const validCurrent = await verifyPassword(
    currentUser.passwordHash,
    currentPassword,
  );
  if (!validCurrent) {
    return { ok: false, error: "Senha atual incorreta" };
  }

  const newHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });
  await invalidateOtherSessions(user.id);

  return { ok: true, data: undefined };
}
