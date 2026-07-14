# 03 — Autenticação (usuário único)

Sem cadastro aberto, sem recuperação de senha por e-mail na v1 (troca de senha em `/perfil`). Usuário criado via `prisma/seed.ts` com `SEED_EMAIL`/`SEED_PASSWORD`/`SEED_NAME` do `.env` (upsert por e-mail; hash sempre recalculado se a senha do env mudar? Não — só cria se não existir, para não sobrescrever senha trocada na UI).

## Senha

- `@node-rs/argon2`, **Argon2id**: `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` (parâmetros OWASP). `src/lib/auth/password.ts`: `hashPassword(pw)`, `verifyPassword(hash, pw)`.
- Validação: mínimo 8 caracteres no seed e na troca.

## Sessão (`src/lib/auth/session.ts`)

- Token: `crypto.randomBytes(32).toString("base64url")`. No banco (`Session.id`) fica **sha256 hex do token**; o token puro só existe no cookie.
- Cookie `session`: `httpOnly`, `secure` em produção, `sameSite: "lax"`, `path: "/"`, `maxAge` 30 dias.
- Expiração deslizante: ao validar, se faltar <15 dias para expirar, estende para +30 dias.
- API: `createSession(userId)`, `validateSession()` (lê cookie, retorna `{ user } | null`), `destroySession()`, `requireSession()` (lança/redireciona se ausente — usado no topo de toda server action e página protegida).
- Logout apaga a linha e o cookie. Trocar senha invalida todas as sessões exceto a atual.

## Rate limiting (`src/lib/auth/rate-limit.ts`)

In-memory (instância única): janela deslizante, chave `login:${ip}`, máx. **10 tentativas falhas por 15 min**; ao exceder, responder erro genérico com espera. Limpar entradas expiradas a cada verificação. IP: `x-forwarded-for` primeiro valor, fallback `"local"`.

## Server actions (`src/server/actions/auth.ts`)

- `login(formData)` → valida zod (email, password), rate limit, busca por e-mail; **sempre** executar `verifyPassword` mesmo se usuário não existir (hash dummy constante) para não vazar existência por timing; erro único "E-mail ou senha incorretos". Sucesso: cria sessão, `redirect("/")`.
- `logout()` → destrói sessão, `redirect("/login")`.
- `changePassword(current, next)` → verifica atual, re-hash, invalida outras sessões.

## Middleware (`src/middleware.ts`)

Protege tudo exceto `/login`, `/api/oauth/*` (têm verificação própria), assets (`/_next`, `/manifest.webmanifest`, `/sw.js`, `/icons`). Sem cookie → redirect `/login`. Verificação **real** da sessão acontece no servidor (`requireSession`) — middleware é só corte rápido de presença de cookie.

## Headers de segurança (`next.config.ts`)

`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), camera=(), microphone=()`. CSRF: server actions do Next já validam Origin; manter `sameSite: lax`.

## Página `/login`

Card centrado, logo textual "Agenda", inputs e-mail/senha (autocomplete correto: `email`, `current-password`), botão primário full-width com estado de loading, erro em texto `--status-critical`. Mobile-first. Sem link de cadastro.

## Criptografia de segredos (`src/lib/crypto.ts`) — usada por todas as ondas

AES-256-GCM com chave derivada de `APP_SECRET` (hex 32 bytes). `encryptSecret(plain): string` (formato `iv.tag.cipher` base64url) e `decryptSecret(payload): string`. Lançar erro claro se `APP_SECRET` ausente/curto.
