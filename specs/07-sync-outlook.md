# 07 — Sync bidirecional Outlook (Microsoft Graph)

Sem SDK: `fetch` direto na Graph REST v1.0 (`https://graph.microsoft.com/v1.0`). Credenciais `MS_CLIENT_ID/SECRET`; app multi-tenant (`common`). Redirect `${APP_URL}/api/oauth/outlook/callback`.

## OAuth

- `GET /api/oauth/outlook/start` — sessão obrigatória; `state` em cookie; authorize: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`, scopes `offline_access Calendars.ReadWrite User.Read`.
- `GET /api/oauth/outlook/callback` — troca code (endpoint `/token`), `GET /me` para e-mail (`mail` ?? `userPrincipalName`), upsert `ConnectedAccount` (tokens criptografados), importa agendas, sync inicial, redirect `/agendas?connected=outlook`.
- `graphFetch(accountId, path, init?)` helper: injeta Bearer, refresh quando expirado (grant `refresh_token`), retry 1x em 401 após refresh; 429 → respeitar `Retry-After`. `invalid_grant` → desconectar conta (como no Google).

## Importação de agendas

`GET /me/calendars`: criar `Calendar` provider OUTLOOK, cor = mapear `hexColor` (quando presente) para o slot mais próximo, senão slot 1. `canEdit: false` → eventos `readOnly`.

## Pull incremental — `syncOutlookAccount(accountId)`

Por agenda: delta query `GET /me/calendars/{id}/calendarView/delta?startDateTime=-30d&endDateTime=+365d` com header `Prefer: odata.maxpagesize=100`; seguir `@odata.nextLink`; persistir `@odata.deltaLink` em `Calendar.syncToken`. Delta expirado (410/`syncStateNotFound`) → full resync.

**Atenção**: `calendarView/delta` retorna **instâncias** (occurrences) e exceções, não mestres com RRULE. Estratégia: itens `type: "occurrence"` de uma série sem alteração são recriados a partir do mestre — buscar mestres via `seriesMasterId`: para cada `seriesMasterId` novo, `GET /me/events/{id}` e mapear `recurrence` (pattern daily/weekly/absoluteMonthly/absoluteYearly → RRULE básico) no evento mestre local; ignorar occurrences regulares (nossa expansão local cobre); `type: "exception"` → exceção local (`originalStartAt` = `originalStart`); `@removed` → cancelamento (exceção CANCELLED se instância, delete se mestre). Padrões de recorrência não representáveis (relativeMonthly etc.): armazenar RRULE aproximado? Não — marcar evento `readOnly` e usar as occurrences do delta materializadas como eventos avulsos filhos (fallback simples e correto visualmente).

Mapeamento: `subject`→title, `bodyPreview`→description (ou `body.content` texto), `location.displayName`→location, `onlineMeeting.joinUrl` ?? `onlineMeetingUrl`→videoLink, `start/end` (`dateTime`+`timeZone`)→UTC, `isAllDay`, attendees (status: `none|notResponded`→needsAction). Convite: `responseStatus.response` do usuário = `notResponded` e `isOrganizer: false` → `NEEDS_ACTION` (notificar como no Google). Guardar `changeKey` em `etag`, `lastModifiedDateTime` em `externalUpdatedAt`.

## Push (OUTLOOK em `push.ts`)

- create → `POST /me/calendars/{id}/events` (com `recurrence` mapeado de RRULE básico quando houver); salvar `id`/`changeKey`.
- update → `PATCH /me/events/{id}` (exceção "this": achar instância via `GET .../instances?startDateTime&endDateTime` e patch nela).
- delete → `DELETE /me/events/{id}`.
- `respondInviteExternal` → `POST /me/events/{id}/accept` ou `/decline` com `{ sendResponse: true }`.

Gatilhos de sync: mesmos do specs/06 via `sync.ts` compartilhado.
