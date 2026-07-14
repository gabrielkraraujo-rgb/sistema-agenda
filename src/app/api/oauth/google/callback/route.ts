// GET /api/oauth/google/callback — conclui o fluxo OAuth (specs/06).
// Valida o state anti-CSRF, troca o code por tokens, resolve o e-mail da
// conta (id_token; fallback userinfo), faz upsert de ConnectedAccount com
// tokens criptografados, importa as agendas e dispara o sync inicial.
// Sucesso: /agendas?connected=google. Erro: /agendas?error=google (warn).

import { NextResponse, type NextRequest } from "next/server";
import type { Credentials } from "google-auth-library";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import {
  createOAuthClient,
  importGoogleCalendars,
  syncGoogleAccount,
} from "@/server/integrations/google";

const STATE_COOKIE = "google_oauth_state";

function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

function redirectClearingState(path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, appUrl()));
  res.cookies.delete(STATE_COOKIE);
  return res;
}

function fail(reason: string, err?: unknown): NextResponse {
  console.warn(`[oauth google] callback: ${reason}`, err ?? "");
  return redirectClearingState("/agendas?error=google");
}

/**
 * E-mail da conta: payload do id_token (veio direto do endpoint de token do
 * Google via TLS — decodificação sem verificação de assinatura é suficiente
 * aqui); fallback no endpoint OIDC userinfo.
 */
async function resolveAccountEmail(tokens: Credentials): Promise<string | null> {
  if (tokens.id_token) {
    const parts = tokens.id_token.split(".");
    if (parts.length >= 2) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64url").toString("utf8"),
        ) as { email?: unknown };
        if (typeof payload.email === "string" && payload.email) {
          return payload.email.toLowerCase();
        }
      } catch {
        // id_token ilegível — tenta o userinfo abaixo
      }
    }
  }

  if (!tokens.access_token) return null;
  try {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: unknown };
    return typeof data.email === "string" && data.email ? data.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl()));
  }

  const params = request.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) return fail(`consentimento negado (${providerError})`);

  const code = params.get("code");
  if (!code) return fail("parâmetro code ausente");

  const state = params.get("state");
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !stateCookie || state !== stateCookie) {
    return fail("state inválido (anti-CSRF)");
  }

  let accountId: string;
  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) return fail("resposta sem access_token");

    const email = await resolveAccountEmail(tokens);
    if (!email) return fail("não foi possível obter o e-mail da conta");

    // Reconexão sem refresh_token novo (não deve ocorrer com prompt=consent,
    // mas por segurança): reaproveita o refresh token já armazenado.
    const existing = await prisma.connectedAccount.findUnique({
      where: { provider_email: { provider: "GOOGLE", email } },
    });
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : existing?.refreshToken;
    if (!refreshTokenEncrypted) return fail("refresh_token ausente");

    const tokenData = {
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: refreshTokenEncrypted,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    };

    const account = await prisma.connectedAccount.upsert({
      where: { provider_email: { provider: "GOOGLE", email } },
      update: tokenData,
      create: { provider: "GOOGLE", email, ...tokenData },
    });
    accountId = account.id;

    await importGoogleCalendars(account.id);
  } catch (err) {
    return fail("troca de tokens/importação de agendas falhou", err);
  }

  // Sync inicial em melhor esforço: a conta já está conectada; uma falha
  // aqui não deve invalidar a conexão (há o botão "Sincronizar agora").
  try {
    await syncGoogleAccount(accountId);
  } catch (err) {
    console.warn("[oauth google] sync inicial falhou:", err);
  }

  return redirectClearingState("/agendas?connected=google");
}
