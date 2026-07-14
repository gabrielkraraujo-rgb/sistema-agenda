import type { Event } from "@prisma/client";
import { prisma } from "@/lib/db";
import { expandOccurrences } from "@/lib/recurrence";
import type {
  AttendeeDTO,
  CalendarProvider,
  OccurrenceDTO,
  TravelInfoDTO,
} from "@/lib/types";

// Agregação de ocorrências (avulsas + expansão de recorrentes + exceções)
// compartilhada por events.ts, dashboard.ts e invites.ts — specs/04.
//
// Regras de exceção (recurringEventId + originalStartAt):
// - Se existir uma exceção para o slot original de uma ocorrência expandida:
//   - status CANCELLED -> ocorrência some;
//   - senão -> a exceção substitui a ocorrência (usa os próprios dados/
//     horário da exceção); só aparece na janela pedida se o horário atual
//     da exceção também cair dentro dela (ex.: se foi movida para fora da
//     janela, ela simplesmente não aparece aqui).
// - Exceções cujo slot original NÃO cai na janela (ex.: evento movido de
//   uma semana para outra) ainda podem aparecer na janela de destino: são
//   varridas separadamente pelo próprio horário atual.

interface CalendarMeta {
  id: string;
  name: string;
  color: string;
  provider: CalendarProvider;
  isReadOnly: boolean;
}

async function loadVisibleCalendars(): Promise<Map<string, CalendarMeta>> {
  const calendars = await prisma.calendar.findMany({
    where: { isVisible: true },
  });
  return new Map(
    calendars.map((cal) => [
      cal.id,
      {
        id: cal.id,
        name: cal.name,
        color: cal.color,
        provider: cal.provider,
        isReadOnly: cal.isReadOnly,
      },
    ]),
  );
}

function parseAttendees(raw: Event["attendees"]): AttendeeDTO[] {
  if (!Array.isArray(raw)) return [];
  return raw as unknown as AttendeeDTO[];
}

function buildTravel(event: Event, occurrenceStart: Date, now: Date): TravelInfoDTO | null {
  if (event.travelDurationMin == null || event.travelDistanceKm == null) {
    return null;
  }

  let lateByMin: number | null = null;
  // Tag "Atrasado" só faz sentido para ocorrências ainda não iniciadas —
  // specs/08.
  if (occurrenceStart.getTime() > now.getTime()) {
    const arrivalMs = now.getTime() + event.travelDurationMin * 60_000;
    const diffMin = Math.ceil((arrivalMs - occurrenceStart.getTime()) / 60_000);
    lateByMin = diffMin > 0 ? diffMin : null;
  }

  return {
    durationMin: event.travelDurationMin,
    distanceKm: event.travelDistanceKm,
    lateByMin,
  };
}

function toOccurrenceDTO(
  event: Event,
  occurrenceStart: Date,
  occurrenceEnd: Date,
  calendar: CalendarMeta,
  isRecurringInstance: boolean,
  now: Date,
): OccurrenceDTO {
  return {
    id: isRecurringInstance
      ? `${event.id}_${occurrenceStart.toISOString()}`
      : event.id,
    eventId: event.id,
    calendarId: calendar.id,
    calendarColor: calendar.color,
    calendarName: calendar.name,
    title: event.title,
    description: event.description,
    location: event.location,
    videoLink: event.videoLink,
    start: occurrenceStart.toISOString(),
    end: occurrenceEnd.toISOString(),
    allDay: event.allDay,
    inviteStatus: event.inviteStatus,
    organizerEmail: event.organizerEmail,
    attendees: parseAttendees(event.attendees),
    isRecurring: isRecurringInstance || !!event.rrule,
    reminderMinutes: event.reminderMinutes,
    provider: calendar.provider,
    travel: buildTravel(event, occurrenceStart, now),
    // Somente leitura: agenda sem permissão de escrita no provedor, ou
    // convite externo ainda não aceito (ver invites.ts).
    readOnly:
      calendar.isReadOnly ||
      (calendar.provider !== "LOCAL" && event.inviteStatus === "NEEDS_ACTION"),
  };
}

/** Janela semiaberta [windowStart, windowEnd). */
export async function collectOccurrences(
  windowStart: Date,
  windowEnd: Date,
): Promise<OccurrenceDTO[]> {
  const calendarMap = await loadVisibleCalendars();
  const calendarIds = [...calendarMap.keys()];
  if (calendarIds.length === 0) return [];

  const now = new Date();

  const [standaloneEvents, masters] = await Promise.all([
    prisma.event.findMany({
      where: {
        calendarId: { in: calendarIds },
        rrule: null,
        recurringEventId: null,
        status: { not: "CANCELLED" },
        inviteStatus: { not: "DECLINED" },
        startAt: { lt: windowEnd },
        endAt: { gt: windowStart },
      },
    }),
    prisma.event.findMany({
      where: {
        calendarId: { in: calendarIds },
        rrule: { not: null },
        recurringEventId: null,
        status: { not: "CANCELLED" },
      },
    }),
  ]);

  const masterIds = masters.map((m) => m.id);
  const exceptions = masterIds.length
    ? await prisma.event.findMany({
        where: { recurringEventId: { in: masterIds } },
      })
    : [];

  const exceptionByKey = new Map<string, Event>();
  for (const exception of exceptions) {
    if (exception.originalStartAt) {
      exceptionByKey.set(
        `${exception.recurringEventId}::${exception.originalStartAt.toISOString()}`,
        exception,
      );
    }
  }

  const results: OccurrenceDTO[] = [];
  const consumedExceptionIds = new Set<string>();

  const inWindow = (d: Date) =>
    d.getTime() >= windowStart.getTime() && d.getTime() < windowEnd.getTime();

  for (const event of standaloneEvents) {
    const calendar = calendarMap.get(event.calendarId);
    if (!calendar) continue;
    results.push(toOccurrenceDTO(event, event.startAt, event.endAt, calendar, false, now));
  }

  for (const master of masters) {
    const calendar = calendarMap.get(master.calendarId);
    if (!calendar || !master.rrule) continue;

    const slots = expandOccurrences(
      { startAt: master.startAt, endAt: master.endAt, rrule: master.rrule },
      windowStart,
      windowEnd,
    );

    for (const slot of slots) {
      const key = `${master.id}::${slot.start.toISOString()}`;
      const exception = exceptionByKey.get(key);

      if (!exception) {
        results.push(toOccurrenceDTO(master, slot.start, slot.end, calendar, true, now));
        continue;
      }

      consumedExceptionIds.add(exception.id);
      if (exception.status === "CANCELLED") continue;
      if (exception.inviteStatus === "DECLINED") continue;
      if (!inWindow(exception.startAt)) continue; // movida para fora da janela

      results.push(
        toOccurrenceDTO(exception, exception.startAt, exception.endAt, calendar, true, now),
      );
    }
  }

  // Exceções movidas PARA dentro desta janela vindas de um slot original
  // fora dela (não foram capturadas pela expansão acima).
  for (const exception of exceptions) {
    if (consumedExceptionIds.has(exception.id)) continue;
    if (exception.status === "CANCELLED") continue;
    if (exception.inviteStatus === "DECLINED") continue;
    if (!inWindow(exception.startAt)) continue;

    const calendar = calendarMap.get(exception.calendarId);
    if (!calendar) continue;

    results.push(
      toOccurrenceDTO(exception, exception.startAt, exception.endAt, calendar, true, now),
    );
  }

  results.sort((a, b) => a.start.localeCompare(b.start));
  return results;
}
