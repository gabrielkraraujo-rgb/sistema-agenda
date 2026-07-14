// GET /api/oauth/outlook/start — specs/07.
// Exige sessão; gera state anti-CSRF (cookie httpOnly de 10 min) e
// redireciona para o consent da Microsoft (tenant common).

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  OUTLOOK_AUTHORIZE_URL,
  OUTLOOK_SCOPES,
} from "@/server/integrations/outlook";

// Next.js só permite exports de handlers em route.ts — o nome do cookie é
// duplicado no callback (manter em sincronia).
const STATE_COOKIE = "outlook_oauth_state";
const STATE_MAX_AGE_S = 10 * 60;

function appUrl(request: NextRequest): string {
  return (process.env.APP_URL ?? request.nextUrl.origin).replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const base = appUrl(request);

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", base));
  }

  const clientId = process.env.MS_CLIENT_ID;
  if (!clientId || !process.env.MS_CLIENT_SECRET) {
    console.warn("[outlook] MS_CLIENT_ID/MS_CLIENT_SECRET não configurados");
    return NextResponse.redirect(new URL("/agendas?error=outlook", base));
  }

  const state = randomBytes(16).toString("base64url");

  const authorize = new URL(OUTLOOK_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", `${base}/api/oauth/outlook/callback`);
  authorize.searchParams.set("response_mode", "query");
  authorize.searchParams.set("scope", OUTLOOK_SCOPES);
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE_S,
  });
  return response;
}
