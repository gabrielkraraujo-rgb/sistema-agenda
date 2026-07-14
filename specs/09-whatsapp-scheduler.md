# 09 — WhatsApp (Evolution API) e agendador

## Cliente Evolution (`src/server/integrations/evolution.ts`)

Config de `Settings` (descriptografar apiKey). `sendWhatsapp(text: string): Promise<boolean>`:
- `POST {evolutionBaseUrl}/message/sendText/{evolutionInstance}` — headers `apikey: <key>`, `Content-Type: application/json`; body `{ "number": "<destino>", "text": "<texto>" }`. Destino: `whatsappTargetNumber` ?? `User.phone` (dígitos apenas, com DDI; normalizar "+55 11 9..." → "5511...").
- Incompleto (sem URL/instância/chave/número) → retornar false sem lançar. Timeout 10 s. Nunca logar a chave.
- `testWhatsapp()` (action specs/04) envia: "Mensagem de teste do sistema Agenda. Configuração funcionando."

## Mensagens (pt-BR, sem emojis, curtas)

- **Resumo diário** (no horário `dailySummaryTime`): "Agenda de hoje, {dia} de {mês}:" + linhas "- 14:00 Reunião X (Escritório Y)" ordenadas; sem eventos → "Você não tem eventos hoje."
- **Lembrete**: "Lembrete: {título} às {HH:mm}{, em {local}}." + quando houver viagem: " Tempo de carro estimado: {n} min."
- **Novo convite**: "Novo convite: {título}, {data} às {HH:mm}, de {organizador}. Responda no app."
- **Atraso**: "Atenção: pelo trânsito atual você chega cerca de {n} min atrasado em {título} ({HH:mm})."

## Scheduler (`src/server/scheduler.ts` + `instrumentation.ts`)

`instrumentation.ts` (raiz): `export async function register()` — só em `process.env.NEXT_RUNTIME === "nodejs"`; guard global (`globalThis.__schedulerStarted`) contra doble registro em dev/HMR. Não iniciar durante `next build` (`NEXT_PHASE === "phase-production-build"`).

Jobs (`node-cron`, todos com `timezone: "America/Sao_Paulo"`):

| Cron | Job |
|---|---|
| `* * * * *` | **Lembretes**: ocorrências (expansão de recorrentes) com início em `[now, now+H]`, onde `H = max(60min, defaultReminderMinutes, maior reminderMinutes entre os eventos) + 5min` — janela fixa de 60 min silenciaria lembretes maiores que 1h; disparo quando `start - reminderMinutes` (do evento, senão padrão global) caiu no último minuto (tolerância: <= now e > now-2min para não perder tick). Dedupe `reminder:<eventId>:<startISO>`. Só se `notifyEventReminder`. |
| `* * * * *` | **Resumo diário**: se `notifyDailySummary` e hora atual (HH:mm local) == `dailySummaryTime`, dedupe `summary:<yyyy-MM-dd>`. |
| `*/5 * * * *` | **Sync**: `syncAllAccounts()` (specs/06/07) com try/catch por conta. |
| `*/10 * * * *` | **Maps + atraso**: `refreshTravelForUpcoming()` + alertas (specs/08), se `notifyLateAlert`. |

`notifyNewInvite(eventId)`: chamada pelo código de sync ao criar evento NEEDS_ACTION novo; dedupe `invite:<eventId>`; só se `notifyNewInvite`. Todos os jobs: try/catch com `console.error` prefixado (`[scheduler]`), nunca derrubar o processo; pular silenciosamente se Evolution não configurada.
