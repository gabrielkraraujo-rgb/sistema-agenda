# 00 — Visão geral

Sistema de organização pessoal, fase 1: **agenda pessoal** de usuário único (um mentorado), mobile-first (uso principal no celular), com:

1. Dashboard: 3 stat tiles (eventos de hoje, eventos da semana, solicitações de evento) + próximos 3 eventos + calendário (dia/semana/mês) com drag & drop.
2. Múltiplas agendas, cada uma com cor própria; CRUD de agendas e eventos.
3. Sync **bidirecional** com Google Calendar e Outlook (convites viram "solicitações").
4. Google Maps: distância + tempo de carro até o local do evento, tag "Atrasado" com minutos de atraso.
5. Notificações WhatsApp via Evolution API: resumo diário, lembrete antes do evento, novo convite, alerta de atraso.
6. Auth e-mail+senha (usuário único, sem cadastro aberto). PWA instalável.

## Stack

Next.js 15 (App Router, Turbopack, TS) · Tailwind v4 · Prisma + Postgres (Docker local `agenda-pg`:5434; Railway depois) · FullCalendar (views + DnD) · googleapis · Microsoft Graph via fetch · rrule · date-fns(-tz) · node-cron · lucide-react (ícones) · @node-rs/argon2.

## Convenções

- UI 100% em pt-BR, acentuação correta, **sem emojis**. Ícones apenas lucide-react.
- Timezone: America/Sao_Paulo (`src/lib/datetime.ts`); banco em UTC.
- DTOs compartilhados: `src/lib/types.ts`. Actions retornam `ActionResult<T>`.
- Entradas de server actions validadas com zod; sessão verificada em toda action (`requireSession()`).
- Segredos no banco criptografados via `src/lib/crypto.ts`.
- Specs numerados por módulo; em conflito entre spec e código, o spec vence.

## Fases e responsabilidade por arquivos

- **Onda 1A (design system/shell):** `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/ui/*`, PWA (`public/manifest.webmanifest`, `public/sw.js`, ícones), página 404.
- **Onda 1B (auth):** `src/lib/auth/*`, `src/middleware.ts`, `src/app/(auth)/login/*`, `src/server/actions/auth.ts`, `prisma/seed.ts`, headers de segurança em `next.config.ts`.
- **Onda 2A (CRUD/settings):** `src/server/actions/{calendars,events,settings,profile,invites,dashboard}.ts`, `src/lib/recurrence.ts`, `src/server/integrations/push.ts` (stub), páginas `/agendas`, `/perfil`, `/configuracoes`, `/solicitacoes`.
- **Onda 2B (dashboard/calendário):** `src/app/(app)/page.tsx`, `src/components/{stat-tile,event-*,calendar-*}.tsx`, integração FullCalendar.
- **Onda 3A/3B (sync):** `src/server/integrations/{google,outlook}.ts`, rotas `/api/oauth/*`, preenchimento do `push.ts`.
- **Onda 3C (maps):** `src/server/integrations/maps.ts`.
- **Onda 3D (whatsapp/cron):** `src/server/integrations/evolution.ts`, `src/server/scheduler.ts`, `instrumentation.ts`.

Não editar arquivos de outra onda além do estritamente combinado no spec do módulo.
