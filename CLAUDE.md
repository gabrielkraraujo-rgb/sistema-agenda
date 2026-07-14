# SistemaAgenda

Agenda pessoal de usuário único (para um mentorado), mobile-first, com sync Google/Outlook, tempo de deslocamento via Google Maps e notificações WhatsApp via Evolution API. Local com Postgres em Docker; deploy futuro no Railway.

## Regras do projeto

- Idioma da UI: **português brasileiro**, com acentuação correta. **Nunca usar emojis** na UI nem no código.
- Timezone canônico: **America/Sao_Paulo** (helpers em `src/lib/datetime.ts`). Datas em UTC no banco.
- Design: estilo Untitled UI — claro, minimalista, whitespace generoso, animações sutis (150–200 ms, ease-out, respeitar `prefers-reduced-motion`). Tema claro apenas. Tokens em `src/app/globals.css`; **specs/01-design-system.md é a fonte da verdade**.
- Mobile é o uso principal: toda tela deve funcionar perfeitamente em 390 px de largura; navegação por bottom nav; formulários em bottom sheets.
- Specs por módulo em `specs/` — leia o spec do módulo antes de implementar ou alterar.
- Contratos compartilhados (tipos DTO) em `src/lib/types.ts` — não duplicar tipos.
- Segredos no banco (API keys, tokens OAuth) sempre criptografados com `src/lib/crypto.ts` (AES-256-GCM com APP_SECRET).
- Server actions com validação **zod** em todas as entradas; nunca confiar em dados do cliente.

## Comandos

- Postgres local: container Docker `agenda-pg` (porta 5434) — `docker start agenda-pg` se parado.
- Dev: `npm run dev` (Turbopack, porta 3000).
- Migrations: `npx prisma migrate dev`; client: `npx prisma generate`.
- Seed do usuário: `npx prisma db seed` (usa SEED_* do `.env`).
- Lint/typecheck: `npm run lint` e `npx tsc --noEmit`.

## Estrutura

- `src/app/(auth)/login` — página pública de login.
- `src/app/(app)/` — rotas autenticadas: `/` (dashboard), `/solicitacoes`, `/agendas`, `/perfil`, `/configuracoes`.
- `src/components/ui/` — componentes base do design system; `src/components/` — componentes de domínio.
- `src/lib/` — db, crypto, auth, datetime, recurrence, types.
- `src/server/actions/` — server actions (CRUD); `src/server/integrations/` — google, outlook, maps, evolution; `src/server/scheduler.ts` — node-cron (registrado em `instrumentation.ts`).
