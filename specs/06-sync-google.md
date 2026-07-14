# 06 — Sync bidirecional Google Calendar

Lib `googleapis`. Credenciais em `GOOGLE_CLIENT_ID/SECRET`; redirect `${APP_URL}/api/oauth/google/callback`.

## OAuth (route handlers)

- `GET /api/oauth/google/start` — exige sessão; gera `state` aleatório (cookie httpOnly de 10 min) e redireciona para consent com `access_type: offline`, `prompt: consent`, scopes: `https://www.googleapis.com/auth/calendar` + `openid email`.
- `GET /api/oauth/google/callback` — valida `state`, troca code por tokens, obtém e-mail (id_token/userinfo), upsert `ConnectedAccount` (tokens criptografados com `encryptSecret`), importa agendas, dispara sync inicial, redirect `/agendas?connected=google`.
- Helper `getGoogleClient(accountId)` — descriptografa, configura OAuth2 client, **refresh automático**: se `tokenExpiresAt` < now+2min, refresh e persistir novo access token (e refresh, se vier). Erro `invalid_grant` → marcar conta como desconectada (apagar tokens; UI de /agendas mostra "Reconectar").

## Importação de agendas

`calendarList.list()`: criar `Calendar` (provider GOOGLE, `externalId`, nome do provedor, cor = slot da paleta mais próximo do `backgroundColor` do Google — comparação RGB simples). Agendas somente-leitura (`accessRole` reader/freeBusyReader) ficam `isVisible` mas eventos `readOnly`.

## Pull incremental — `syncGoogleAccount(accountId)`

Por agenda: `events.list({ calendarId: externalId, syncToken, singleEvents: false, showDeleted: true })` paginado; sem syncToken (primeira vez): janela de -30 dias a +365 dias (`timeMin/timeMax`). HTTP 410 → limpar syncToken e full resync. Salvar novo `nextSyncToken` no `Calendar.syncToken`.

Mapeamento por item (upsert por `[calendarId, externalId]`):
- `status: "cancelled"`: instância cancelada (tem `recurringEventId`) → exceção CANCELLED local; mestre cancelado → apagar mestre + exceções.
- Datas: `start.dateTime` (com TZ) → UTC; `start.date` → allDay (fim exclusivo do Google → armazenar como está e tratar na UI).
- `recurrence` (RRULE array) → `rrule` (primeira linha RRULE); instâncias modificadas (`recurringEventId` + `originalStartTime`) → exceção local.
- `attendees` → JSON; o próprio usuário (`self: true`) com `responseStatus: "needsAction"` → `inviteStatus: NEEDS_ACTION` (se novo, sinalizar para notificação — chamar `notifyNewInvite(eventId)` do specs/09 se configurado); `declined` → DECLINED; senão ACCEPTED/NONE (sem attendees = NONE).
- Guardar `etag`, `externalUpdatedAt = updated`. **Conflito**: se local `updatedAt` > `externalUpdatedAt` e o evento tem alterações não enviadas, última escrita vence (remoto sobrescreve — documentar; caso raro em uso pessoal).

## Push (implementa `push.ts` para GOOGLE)

- create → `events.insert` (com `attendees`, `recurrence: [rrule]`, `sendUpdates: "all"` quando houver convidados); salvar `externalId`/`etag` retornados.
- update → `events.patch` com `If-Match: etag` (412 → re-pull da agenda e reaplicar? Não: retornar erro "Evento mudou no Google, sincronize" e disparar pull).
- delete → `events.delete` (`sendUpdates: "all"`). Exceção "this": patch/delete da **instância** via `events.instances` para achar o instanceId pelo `originalStartTime`.
- `respondInviteExternal` → patch do attendee self com `responseStatus: accepted|declined`.

## Gatilhos de sync

- Cron a cada 5 min (specs/09 chama `syncAllAccounts()` — exportar de `src/server/integrations/sync.ts` que varre contas GOOGLE e OUTLOOK).
- Botão "Sincronizar agora" em /agendas (action `triggerSync()`).
- Ao carregar o dashboard, sync best-effort se último sync > 2 min (não bloquear render; `after()` do Next ou fire-and-forget com catch).

Registrar `lastSyncAt`? Usar `ConnectedAccount.updatedAt` como aproximação — não; adicionar campo se necessário via migration própria da onda (permitido: migration aditiva `lastSyncAt DateTime?` em ConnectedAccount).
