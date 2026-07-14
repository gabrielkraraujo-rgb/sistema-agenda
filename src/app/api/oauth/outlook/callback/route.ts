// GET /api/oauth/outlook/callback — specs/07.
// Valida state, troca o code por tokens (tenant common), busca o e-mail em
// GET /me (mail ?? userPrincipalName), upsert de ConnectedAccount (tokens
// criptografados), importa agendas, dispara sync inicial e redireciona para
// /agendas?connected=outlook. Qualquer falha → /agendas?error=outlook.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getSessionUser } from "@/lib/auth/session";
import {
  OUTLOOK_SCOPES,
  OUTLOOK_TOKEN_URL,
  importOutlookCalendars,
  syncOutlookAccount,
} from "@/server/integrations/outlook";

// Manter em sincronia com start/route.ts.
const STATE_COOKIE = "outlook_oauth_state";

const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me";

function appUrl(request: NextRequest): string {
  return (process.env.APP_URL ?? request.nextUrl.origin).replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const base = appUrl(request);

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", base));
  }

  const fail = (reason: string, err?: unknown): NextResponse => {
    console.warn(`[outlook] OAuth callback falhou: ${reason}`, err ?? "");
    const response = NextResponse.redirect(new URL("/agendas?error=outlook", base));
    response.cookies.delete(STATE_COOKIE);
    return response;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    return fail(params.get("error_description") ?? params.get("error")!);
  }

  const code = params.get("code");
  if (!code) return fail("code ausente");

  const state = params.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !cookieState || state !== cookieState) {
    return fail("state inválido (possível CSRF)");
  }

  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail("MS_CLIENT_ID/MS_CLIENT_SECRET não configurados");
  }

  try {
    // Troca do code por tokens.
    const tokenRes = await fetch(OUTLOOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${base}/api/oauth/outlook/callback`,
        scope: OUTLOOK_SCOPES,
      }),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokens.access_token) {
      return fail(
        `troca de code: HTTP ${tokenRes.status} ${tokens.error ?? ""} ${tokens.error_description ?? ""}`,
      );
    }

    // E-mail da conta conectada.
    const meRes = await fetch(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = (await meRes.json().catch(() => ({}))) as {
      mail?: string | null;
      userPrincipalName?: string | null;
    };
    if (!meRes.ok) return fail(`GET /me: HTTP ${meRes.status}`);
    const email = me.mail ?? me.userPrincipalName;
    if (!email) return fail("GET /me sem mail/userPrincipalName");

    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    const existing = await prisma.connectedAccount.findUnique({
      where: { provider_email: { provider: "OUTLOOK", email } },
    });
    if (!existing && !tokens.refresh_token) {
      return fail("resposta sem refresh_token (offline_access não concedido)");
    }

    const account = existing
      ? await prisma.connectedAccount.update({
          where: { id: existing.id },
          data: {
            accessToken: encryptSecret(tokens.access_token),
            ...(tokens.refresh_token
              ? { refreshToken: encryptSecret(tokens.refresh_token) }
              : {}),
            tokenExpiresAt,
            scope: tokens.scope ?? OUTLOOK_SCOPES,
          },
        })
      : await prisma.connectedAccount.create({
          data: {
            provider: "OUTLOOK",
            email,
            accessToken: encryptSecret(tokens.access_token),
            refreshToken: encryptSecret(tokens.refresh_token!),
            tokenExpiresAt,
            scope: tokens.scope ?? OUTLOOK_SCOPES,
          },
        });

    await importOutlookCalendars(account.id);

    // Sync inicial: a conta já está conectada; se falhar aqui, o cron de
    // 5 min (specs/09) reexecuta — não degrada para ?error=outlook.
    try {
      await syncOutlookAccount(account.id);
    } catch (err) {
      console.warn("[outlook] sync inicial falhou (o cron tentará de novo):", err);
    }

    const response = NextResponse.redirect(new URL("/agendas?connected=outlook", base));
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (err) {
    return fail("erro inesperado", err);
  }
}
