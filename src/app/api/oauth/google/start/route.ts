// GET /api/oauth/google/start — inicia o fluxo OAuth do Google (specs/06).
// Exige sessão; gera state anti-CSRF em cookie httpOnly de 10 min e
// redireciona para a tela de consentimento com access_type=offline +
// prompt=consent (garante refresh_token em toda conexão).

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createOAuthClient, GOOGLE_OAUTH_SCOPES } from "@/server/integrations/google";

const STATE_COOKIE = "google_oauth_state";
const STATE_MAX_AGE_SECONDS = 10 * 60;

function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl()));
  }

  try {
    const client = createOAuthClient();
    const state = randomBytes(16).toString("base64url");
    const consentUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_OAUTH_SCOPES,
      state,
    });

    const res = NextResponse.redirect(consentUrl);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: STATE_MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    console.warn("[oauth google] start falhou:", err);
    return NextResponse.redirect(new URL("/agendas?error=google", appUrl()));
  }
}
