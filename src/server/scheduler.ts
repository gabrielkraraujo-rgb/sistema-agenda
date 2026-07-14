// Agendador node-cron — specs/09 (Onda 3D). Registrado no boot do servidor
// por src/instrumentation.ts. Todos os jobs: timezone America/Sao_Paulo,
// try/catch com log "[scheduler]", nunca derrubam o processo e pulam
// silenciosamente se a Evolution API não estiver configurada.

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { prisma } from "@/lib/db";
import { TIMEZONE } from "@/lib/types";
import type { OccurrenceDTO } from "@/lib/types";
import { dayBoundsUtc, formatInTz, formatTime } from "@/lib/datetime";
import { getSettingsRow } from "@/server/actions/settings";
import { collectOccurrences } from "@/server/occurrences";
import { syncAllAccounts } from "@/server/integrations/sync";
import { refreshTravelForUpcoming } from "@/server/integrations/maps";
import {
  claimNotification,
  hasEvolutionConfig,
  releaseNotification,
  sendLateAlert,
  sendWhatsapp,
} from "@/server/integrations/evolution";

/** Tolerância da janela do lembrete: dispara se o "momento do lembrete"
 * (start - reminderMinutes) caiu em (now - 2min, now] — não perde o tick
 * mesmo se o cron atrasar alguns segundos; o dedupe impede duplicidade. */
const REMINDER_TOLERANCE_MS = 2 * 60_000;

const HOUR_MS = 60 * 60_000;

// ── Mensagens (exportadas para teste) ────────────────────────────────────

export function buildReminderMessage(
  occ: Pick<OccurrenceDTO, "title" | "start" | "location" | "travel">,
): string {
  const place = occ.location ? `, em ${occ.location}` : "";
  let message = `Lembrete: ${occ.title} às ${formatTime(occ.start)}${place}.`;
  if (occ.travel) {
    message += ` Tempo de carro estimado: ${occ.travel.durationMin} min.`;
  }
  return message;
}

export function buildDailySummaryMessage(
  now: Date,
  occurrences: Pick<OccurrenceDTO, "title" | "start" | "location" | "allDay">[],
): string {
  if (occurrences.length === 0) return "Você não tem eventos hoje.";
  const lines = occurrences.map((occ) => {
    const time = occ.allDay ? "Dia inteiro" : formatTime(occ.start);
    const place = occ.location ? ` (${occ.location})` : "";
    return `- ${time} ${occ.title}${place}`;
  });
  return [`Agenda de hoje, ${formatInTz(now, "d 'de' MMMM")}:`, ...lines].join("\n");
}

// ── Jobs (exportados para teste; `now` injetável) ────────────────────────

/** A cada minuto: lembretes de eventos próximos. */
export async function runReminderJob(now: Date = new Date()): Promise<void> {
  const settings = await getSettingsRow();
  if (!settings.notifyEventReminder || !hasEvolutionConfig(settings)) return;

  // A janela de coleta precisa alcançar o maior lembrete possível: um
  // lembrete de N min dispara quando o evento ainda está a ~N min de
  // distância. Janela fixa de 60 min silenciaria lembretes maiores que 1h
  // (o zod aceita até 10080 min no evento e 1440 no padrão global).
  const { _max } = await prisma.event.aggregate({
    _max: { reminderMinutes: true },
  });
  const horizonMin =
    Math.max(60, settings.defaultReminderMinutes, _max.reminderMinutes ?? 0) + 5;

  const occurrences = await collectOccurrences(
    now,
    new Date(now.getTime() + horizonMin * 60_000),
  );

  for (const occ of occurrences) {
    if (occ.allDay) continue; // lembrete com HH:mm não se aplica a dia inteiro
    const reminderMinutes = occ.reminderMinutes ?? settings.defaultReminderMinutes;
    const fireAtMs = new Date(occ.start).getTime() - reminderMinutes * 60_000;
    if (fireAtMs > now.getTime()) continue; // ainda não chegou a hora
    if (fireAtMs <= now.getTime() - REMINDER_TOLERANCE_MS) continue; // passou

    const dedupeKey = `reminder:${occ.eventId}:${occ.start}`;
    if (!(await claimNotification("EVENT_REMINDER", dedupeKey, occ.eventId))) {
      continue;
    }
    const sent = await sendWhatsapp(buildReminderMessage(occ));
    if (!sent) await releaseNotification(dedupeKey);
  }
}

/** A cada minuto: resumo diário quando HH:mm local == dailySummaryTime. */
export async function runDailySummaryJob(now: Date = new Date()): Promise<void> {
  const settings = await getSettingsRow();
  if (!settings.notifyDailySummary || !hasEvolutionConfig(settings)) return;
  if (formatInTz(now, "HH:mm") !== settings.dailySummaryTime) return;

  const dedupeKey = `summary:${formatInTz(now, "yyyy-MM-dd")}`;
  if (!(await claimNotification("DAILY_SUMMARY", dedupeKey))) return;

  const { start, end } = dayBoundsUtc(now);
  const occurrences = await collectOccurrences(start, end);
  const sent = await sendWhatsapp(buildDailySummaryMessage(now, occurrences));
  if (!sent) await releaseNotification(dedupeKey);
}

/** A cada 5 min: pull incremental de todas as contas conectadas. */
export async function runSyncJob(): Promise<void> {
  await syncAllAccounts();
}

/** A cada 10 min: atualiza rotas e dispara alertas de atraso (>= 5 min). */
export async function runTravelAndLateAlertJob(
  now: Date = new Date(),
): Promise<void> {
  await refreshTravelForUpcoming();

  const settings = await getSettingsRow();
  if (!settings.notifyLateAlert || !hasEvolutionConfig(settings)) return;

  const occurrences = await collectOccurrences(
    now,
    new Date(now.getTime() + 3 * HOUR_MS),
  );
  for (const occ of occurrences) {
    const lateByMin = occ.travel?.lateByMin;
    if (lateByMin == null || lateByMin < 5) continue;
    // sendLateAlert cuida do dedupe "late:<eventId>:<startISO>".
    await sendLateAlert(occ.eventId, occ.start, lateByMin);
  }
}

// ── Registro dos crons ───────────────────────────────────────────────────

let tasks: ScheduledTask[] = [];

function guarded(name: string, job: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await job();
    } catch (err) {
      console.error(`[scheduler] job "${name}" falhou:`, err);
    }
  };
}

/** Inicia os 4 jobs (idempotente — chamadas repetidas são no-op). */
export function startScheduler(): void {
  if (tasks.length > 0) return;

  const options = { timezone: TIMEZONE };
  tasks = [
    cron.schedule("* * * * *", guarded("lembretes", () => runReminderJob()), options),
    cron.schedule("* * * * *", guarded("resumo-diario", () => runDailySummaryJob()), options),
    cron.schedule("*/5 * * * *", guarded("sync", () => runSyncJob()), options),
    cron.schedule("*/10 * * * *", guarded("maps-atraso", () => runTravelAndLateAlertJob()), options),
  ];
  console.log(
    "[scheduler] iniciado: lembretes e resumo diário (1 min), sync (5 min), maps/atraso (10 min) — timezone America/Sao_Paulo",
  );
}

/** Para e destrói os jobs (usado em testes/shutdown). */
export async function stopScheduler(): Promise<void> {
  const current = tasks;
  tasks = [];
  for (const task of current) {
    try {
      await task.destroy();
    } catch (err) {
      console.error("[scheduler] falha ao parar job:", err);
    }
  }
}
