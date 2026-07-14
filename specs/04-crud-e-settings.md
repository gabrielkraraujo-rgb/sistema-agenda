# 04 — CRUD de agendas/eventos, recorrência, perfil e configurações

Todas as actions: `"use server"`, zod no input, `requireSession()` no topo, retorno `ActionResult<T>` (exceto quando `redirect`). Após mutação, `revalidatePath` das rotas afetadas.

## Agendas (`src/server/actions/calendars.ts`)

Modelo atual: as agendas do sistema são só as conectadas (Google/Outlook) — não há criação de agenda local pela UI. Nome e cor de cada agenda são definidos pelo usuário **depois** de conectar; o nome vindo do provedor na importação é só o valor inicial (specs/06 e specs/07: reimportações não sobrescrevem mais o nome, só `isReadOnly`).

- `listCalendars(): CalendarDTO[]` — inclui `eventCount`, `accountId` (agrupamento por conta na UI) e `isReadOnly`.
- `createCalendar({ name, color })` — cor deve ser um hex de `CALENDAR_COLORS`; primeira agenda criada vira `isDefault`. Provider LOCAL. Continua existindo no backend para não quebrar dados legados, mas sem affordance na UI (agendas locais não fazem mais parte do fluxo principal).
- `updateCalendar({ id, name?, color?, isVisible?, isDefault? })` — `isDefault: true` zera o default anterior. `name` é editável para qualquer provider (é assim que o usuário nomeia a agenda depois de conectar).
- `deleteCalendar(id)` — apaga a agenda com os eventos locais (confirmação na UI). Não permitir apagar a última agenda visível. Na UI, exposto só para agendas `LOCAL` legadas (grupo discreto "Agendas locais" em /agendas); para GOOGLE/OUTLOOK o caminho é desconectar a conta inteira (`disconnectAccount`, ver seção de sync/contas).

## Eventos (`src/server/actions/events.ts`)

- `createEvent(input: EventInput)` — validar `end > start` (exceto allDay de 1 dia), title 1..200. Se `recurrence`, gerar RRULE string (`FREQ=...`) e salvar no campo `rrule`. Após salvar, chamar `pushEventChange(event, "create")` e, se houver `location`, `refreshTravelInfo(eventId)` best-effort (não bloquear o retorno em erro de Maps).
- `updateEvent({ eventId, occurrenceStart, scope, patch: Partial<EventInput> })`:
  - Evento avulso ou `scope: "all"`: atualiza o mestre (ajustando `startAt/endAt` base quando datas mudarem).
  - `scope: "this"` em recorrente: cria **exceção** — nova linha com `recurringEventId` = mestre, `originalStartAt` = occurrenceStart, campos da instância.
- `deleteEvent({ eventId, occurrenceStart, scope })` — `"this"`: exceção com `status: CANCELLED`; `"all"`/avulso: apaga mestre + exceções. Push correspondente.
- `moveEvent(input: MoveEventInput)` — usado pelo drag & drop; mesma semântica de escopo do update. DnD em recorrente pergunta escopo na UI antes de chamar.
- `getOccurrences({ start, end }): OccurrenceDTO[]` — janela [start, end): eventos avulsos no intervalo + expansão de recorrentes via `src/lib/recurrence.ts` + aplicação de exceções (substituição por `originalStartAt`; CANCELLED some). Só agendas `isVisible`. Excluir `status: CANCELLED` e `inviteStatus: DECLINED`. Incluir `NEEDS_ACTION` (a UI marca como pendente). Preencher `travel` a partir do cache do evento quando houver (ver specs/08; `lateByMin` calculado na hora: `now + durationMin > start` para ocorrências futuras de hoje).
- `getUpcomingEvents(limit = 3)` — próximas ocorrências a partir de agora (mesma expansão), excluindo NEEDS_ACTION.

## Recorrência (`src/lib/recurrence.ts`)

Lib `rrule`. Suportar na criação: DAILY, WEEKLY (dia da semana do start), MONTHLY (dia do mês), YEARLY — sem fim (`COUNT`/`UNTIL` só se vier de sync externo; preservar regras completas vindas de fora e expandi-las com a própria lib). `expandOccurrences(event, windowStart, windowEnd): { start, end }[]` — cuidado com DST: expandir no timezone local (America/Sao_Paulo) preservando hora do dia, converter para UTC na saída. Cap de 500 instâncias por janela.

## Dashboard (`src/server/actions/dashboard.ts`)

`getDashboardStats(): DashboardStatsDTO` — hoje = ocorrências no dia atual (TZ local); semana = semana corrente seg–dom; solicitações = eventos `NEEDS_ACTION` futuros.

## Convites (`src/server/actions/invites.ts`)

- `listInvites(): OccurrenceDTO[]` — `NEEDS_ACTION` futuros, ordenados por start.
- `respondInvite({ eventId, response: "ACCEPTED" | "DECLINED" })` — atualiza `inviteStatus` e chama `respondInviteExternal(event, response)` do provedor (via `push.ts`). Se falhar o push, reverter e retornar erro.

## Perfil (`src/server/actions/profile.ts`)

- `getProfile(): ProfileDTO`; `updateProfile({ name, email, phone?, address? })` — se `address` mudou: zerar lat/lng e tentar `geocodeAddress` (specs/08) best-effort; `addressGeocoded = lat != null`.

## Configurações (`src/server/actions/settings.ts`)

- `getSettings(): SettingsDTO` — nunca retornar chaves em claro (`*Set: boolean`).
- `updateSettings(patch)` — chaves recebidas não-vazias são criptografadas com `encryptSecret` antes de salvar; string vazia = manter atual; `null` explícito = limpar. Validar `dailySummaryTime` como HH:mm.
- `testWhatsapp()` — envia mensagem de teste via Evolution (specs/09), retorna sucesso/erro para a UI.
- Linha única: `prisma.settings.upsert({ where: { id: 1 } ... })`; `getSettingsRow()` helper interno para outras ondas.

## Stub de push (`src/server/integrations/push.ts`) — criado na onda 2A, preenchido na 3

```ts
export async function pushEventChange(eventId: string, kind: "create" | "update" | "delete"): Promise<void> {}
export async function respondInviteExternal(eventId: string, response: "ACCEPTED" | "DECLINED"): Promise<void> {}
```
No stub, no-op para provider LOCAL e lançar `new Error("Sync ainda não implementado")` para os demais — a onda 3 substitui pelo dispatch real (google/outlook).

## Páginas da onda 2A → /agendas

Modelo atual: as agendas do sistema são só as conectadas (Google/Outlook) — não há mais criação de agenda local pela UI (`createCalendar` continua existindo no backend, sem affordance na tela). Nome e cor de cada agenda são definidos pelo usuário **depois** de conectar; o nome do provedor é usado só como valor inicial na importação (reimportações não sobrescrevem mais o nome, só `isReadOnly`).

- Botão "Sincronizar agora" no topo (mesmo comportamento/toasts da onda 3: `triggerSync`).
- Para cada conta conectada (`listConnectedAccounts`), um Card com: cabeçalho (e-mail, badge Google/Outlook, botão "Desconectar" que abre Dialog de confirmação — texto: "Remove a conta e as agendas/eventos dela deste sistema. Nada é apagado no Google/Outlook."); e a lista das agendas daquela conta (dot da cor, nome, badge "Somente leitura" quando `isReadOnly`, switch de visibilidade, ação "Definir padrão", e botão "Editar" bem visível — sheet com Input de nome + ColorPicker, já que é assim que o usuário define nome/cor após conectar).
- `disconnectAccount(accountId)` (`src/server/actions/sync.ts`): apaga o `ConnectedAccount`; o cascade do schema (`ConnectedAccount` → `Calendar` → `Event`) remove localmente as agendas e eventos da conta. Nada é revogado ou apagado no provedor.
- Se existirem agendas `LOCAL` legadas no banco, aparecem num grupo discreto "Agendas locais" com as mesmas ações de editar/excluir (fluxo secundário, só para não deixar dados órfãos).
- EmptyState quando não há nenhuma conta conectada: frase explicando que as agendas vêm das contas conectadas + botões "Conectar Google" / "Conectar Outlook" apontando para `/api/oauth/{google|outlook}/start`. Com contas presentes, os mesmos botões aparecem menores no rodapé da página (permitindo conectar outra conta).
- `CalendarDTO` inclui `accountId: string | null` (agrupamento por conta) e `isReadOnly: boolean`, além dos campos já existentes.
- **/perfil**: form nome, e-mail, telefone (placeholder +55…), endereço (textarea 2 linhas; hint: "usado para calcular o tempo até seus compromissos"), status de geocodificação; seção trocar senha.
- **/configuracoes**: seções WhatsApp (Evolution: URL base, instância, API key tipo password com "definida" quando `*Set`, número destino, botão "Enviar teste"), Google Maps (API key), Notificações (switches dos 4 gatilhos + horário do resumo + antecedência padrão).
- **/solicitacoes**: lista de convites pendentes (EventCard com organizador e horário; botões Aceitar/Recusar), EmptyState quando vazio.
