import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 renomeou o arquivo de convenção `middleware.ts` para
// `proxy.ts` (a função continua sendo o corte rápido antes da renderização).
// Ver node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// e node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
//
// specs/03-auth.md: este é só um corte rápido pela PRESENÇA do cookie
// `session` — a validação real (assinatura, expiração, sliding expiration)
// acontece no servidor via requireSession()/validateSession()
// (src/lib/auth/session.ts), chamada no topo de toda server action e
// página protegida.

// Nome do cookie de sessão — deve ficar em sincronia com COOKIE_NAME em
// src/lib/auth/session.ts (specs/03-auth.md define o nome fixo "session").
const SESSION_COOKIE_NAME = "session";

const PUBLIC_EXACT_PATHS = new Set<string>([
  "/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
]);

const PUBLIC_PREFIXES = ["/api/oauth/", "/_next/", "/icons/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (isPublicPath(pathname)) {
    // Já autenticado tentando acessar /login → manda para a home.
    if (pathname === "/login" && hasSessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Roda em tudo exceto assets estáticos internos do Next (já também
  // filtrados via PUBLIC_PREFIXES acima, redundância intencional).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
