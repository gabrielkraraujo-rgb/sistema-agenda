"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { buildRruleString } from "@/lib/recurrence";
import { collectOccurrences } from "@/server/occurrences";
import { pushEventChange } from "@/server/integrations/push";
import { refreshTravelInfo } from "@/server/integrations/maps";
import type {
  ActionResult,
  AttendeeDTO,
  CalendarProvider,
  DeleteEventInput,
  EditScope,
  EventInput,
  MoveEventInput,
  OccurrenceDTO,
  UpdateEventInput,
} from "@/lib/types";

// ── Validação (zod) ───────────────────────────────────────────────────────

const attendeeSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(120).optional(),
  response: z.enum(["accepted", "declined", "tentative", "needsAction"]).optional(),
});

const recurrenceSchema = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
});

const eventInputSchema = z.object({
  calendarId: z.string().min(1, "Selecione uma agenda"),
  title: z.string().trim().min(1, "Informe um título").max(200, "Título muito longo"),
  description: z.string().trim().max(5000).optional(),
  location: z.string().trim().max(300).optional(),
  // placeId do Google (Places New) validado para `location` — specs/08.
  locationPlaceId: z.string().trim().max(300).nullable().optional(),
  // Só http(s); links sem protocolo ganham https:// (security-check F4 —
  // impede armazenar javascript:/data: e abrir via window.open).
  videoLink: z
    .string()
    .trim()
    .max(500, "Link muito longo")
    .transform((v) =>
      v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v,
    )
    .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Link de vídeo inválido")
    .optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  allDay: z.boolean(),
  attendees: z.array(attendeeSchema).optional(),
  reminderMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});

const scopeSchema: z.ZodType<EditScope> = z.enum(["this", "all"]);

const updateEventSchema = z.object({
  eventId: z.string().min(1),
  occurrenceStart: z.string().min(1),
  scope: scopeSchema,
  patch: eventInputSchema.partial(),
});

const deleteEventSchema = z.object({
  eventId: z.string().min(1),
  occurrenceStart: z.string().min(1),
  scope: scopeSchema,
});

const moveEventSchema = z.object({
  eventId: z.string().min(1),
  occurrenceStart: z.string().min(1),
  newStart: z.string().min(1),
  newEnd: z.string().min(1),
  scope: scopeSchema,
});

const windowSchema = z.object({ start: z.string().min(1), end: z.string().min(1) });

// ── Helpers internos ──────────────────────────────────────────────────────

function firstIssueMessage(error: z.ZodError, fallback = "Dados inválidos"): string {
  return error.issues[0]?.message ?? fallback;
}

type RangeResult =
  | { ok: true; start: Date; end: Date }
  | { ok: false; error: string };

function parseAndValidateRange(startIso: string, endIso: string, allDay: boolean): RangeResult {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: "Data inválida" };
  }
  if (allDay) {
    if (end.getTime() < start.getTime()) {
      return { ok: false, error: "O fim deve ser igual ou depois do início" };
    }
  } else if (end.getTime() <= start.getTime()) {
    return { ok: false, error: "O fim deve ser depois do início" };
  }
  return { ok: true, start, end };
}

function attendeesToJsonInput(
  attendees: AttendeeDTO[] | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!attendees || attendees.length === 0) return Prisma.JsonNull;
  return attendees as unknown as Prisma.InputJsonValue;
}

/**
 * Próximo `locationPlaceId` para uma linha (master ou exceção): um novo
 * placeId enviado explicitamente prevalece; se não veio mas o texto de
 * `location` mudou em relação ao valor anterior dessa linha, o placeId
 * antigo fica obsoleto e é limpo; senão mantém o valor anterior — specs/08
 * (mesma regra de `updateProfile` em profile.ts).
 */
function resolveLocationPlaceId(
  patch: ScopedPatch,
  previousLocation: string | null,
  previousPlaceId: string | null,
): string | null {
  if (patch.locationPlaceId !== undefined) return patch.locationPlaceId || null;
  if (patch.location !== undefined && (patch.location || null) !== (previousLocation ?? null)) {
    return null;
  }
  return previousPlaceId;
}

/**
 * Dispara o sync externo em melhor esforço. As actions já carregaram a
 * agenda (para validar a operação) e sabem o `provider` — só chamamos
 * `pushEventChange` para agendas não-LOCAL, e nunca deixamos uma falha de
 * sync derrubar uma mutação local já concluída (specs/04 só exige
 * "não bloquear" explicitamente para o Maps, mas a mesma filosofia se
 * aplica aqui: o dado local é a fonte de verdade desta onda).
 */
async function dispatchPushBestEffort(
  eventId: string,
  kind: "create" | "update" | "delete",
  provider: CalendarProvider,
): Promise<void> {
  if (provider === "LOCAL") return;
  try {
    await pushEventChange(eventId, kind);
  } catch (err) {
    console.warn(`[events] pushEventChange(${kind}) falhou:`, err);
  }
}

type ScopedPatch = Partial<EventInput>;

type EventWithCalendar = Prisma.EventGetPayload<{ include: { calendar: true } }>;

/**
 * Ocorrências editadas ("somente este") viram linhas de exceção com id
 * próprio — é esse id que a UI envia de volta. Quando o escopo é "all",
 * a intenção do usuário é a série inteira: redireciona para o mestre
 * (`recurringEventId`). Com escopo "this", a própria exceção é o alvo.
 */
async function resolveScopeTarget(
  event: EventWithCalendar,
  scope: EditScope,
): Promise<EventWithCalendar> {
  if (scope !== "all" || !event.recurringEventId) return event;
  const seriesMaster = await prisma.event.findUnique({
    where: { id: event.recurringEventId },
    include: { calendar: true },
  });
  return seriesMaster ?? event;
}

/** Lógica compartilhada por `updateEvent` e `moveEvent` (mesma semântica de escopo). */
async function applyScopedChange(
  eventId: string,
  occurrenceStart: string,
  scope: EditScope,
  patch: ScopedPatch,
): Promise<ActionResult> {
  const target = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: true },
  });
  if (!target) return { ok: false, error: "Evento não encontrado" };
  const master = await resolveScopeTarget(target, scope);
  if (master.calendar.isReadOnly) {
    return { ok: false, error: "Esta agenda é somente leitura no provedor" };
  }

  const originalStartAt = new Date(occurrenceStart);
  if (Number.isNaN(originalStartAt.getTime())) {
    return { ok: false, error: "Ocorrência inválida" };
  }

  if (patch.calendarId) {
    const targetCalendar = await prisma.calendar.findUnique({ where: { id: patch.calendarId } });
    if (!targetCalendar) return { ok: false, error: "Agenda não encontrada" };
    if (targetCalendar.isReadOnly) {
      return { ok: false, error: "A agenda de destino é somente leitura no provedor" };
    }
  }

  const isRecurringMaster = !!master.rrule;

  // No escopo "this" o push deve apontar para a linha de exceção (o provedor
  // traduz para a instância remota via recurringEventId + originalStartAt).
  let pushTargetId = master.id;

  if (!isRecurringMaster || scope === "all") {
    const nextAllDay = patch.allDay ?? master.allDay;
    let nextStart = master.startAt;
    let nextEnd = master.endAt;

    if (patch.start !== undefined || patch.end !== undefined) {
      const range = parseAndValidateRange(
        patch.start ?? master.startAt.toISOString(),
        patch.end ?? master.endAt.toISOString(),
        nextAllDay,
      );
      if (!range.ok) return { ok: false, error: range.error };
      nextStart = range.start;
      nextEnd = range.end;
    }

    const nextRrule =
      patch.recurrence !== undefined
        ? patch.recurrence
          ? buildRruleString(patch.recurrence.freq)
          : null
        : master.rrule;

    await prisma.event.update({
      where: { id: master.id },
      data: {
        ...(patch.calendarId !== undefined ? { calendarId: patch.calendarId } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description || null } : {}),
        ...(patch.location !== undefined ? { location: patch.location || null } : {}),
        locationPlaceId: resolveLocationPlaceId(patch, master.location, master.locationPlaceId),
        ...(patch.videoLink !== undefined ? { videoLink: patch.videoLink || null } : {}),
        startAt: nextStart,
        endAt: nextEnd,
        allDay: nextAllDay,
        ...(patch.attendees !== undefined
          ? { attendees: attendeesToJsonInput(patch.attendees) }
          : {}),
        ...(patch.reminderMinutes !== undefined
          ? { reminderMinutes: patch.reminderMinutes }
          : {}),
        rrule: nextRrule,
      },
    });
  } else {
    // scope "this" em recorrente: cria (ou atualiza, se já existir) a exceção.
    const existingException = await prisma.event.findFirst({
      where: { recurringEventId: master.id, originalStartAt },
    });

    const durationMs = master.endAt.getTime() - master.startAt.getTime();
    const baseStart = existingException?.startAt ?? originalStartAt;
    const baseEnd = existingException?.endAt ?? new Date(originalStartAt.getTime() + durationMs);
    const baseAllDay = existingException?.allDay ?? master.allDay;

    let nextStart = baseStart;
    let nextEnd = baseEnd;
    const nextAllDay = patch.allDay ?? baseAllDay;

    if (patch.start !== undefined || patch.end !== undefined) {
      const range = parseAndValidateRange(
        patch.start ?? baseStart.toISOString(),
        patch.end ?? baseEnd.toISOString(),
        nextAllDay,
      );
      if (!range.ok) return { ok: false, error: range.error };
      nextStart = range.start;
      nextEnd = range.end;
    }

    if (existingException) {
      await prisma.event.update({
        where: { id: existingException.id },
        data: {
          ...(patch.calendarId !== undefined ? { calendarId: patch.calendarId } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description || null } : {}),
          ...(patch.location !== undefined ? { location: patch.location || null } : {}),
          locationPlaceId: resolveLocationPlaceId(
            patch,
            existingException.location,
            existingException.locationPlaceId,
          ),
          ...(patch.videoLink !== undefined ? { videoLink: patch.videoLink || null } : {}),
          startAt: nextStart,
          endAt: nextEnd,
          allDay: nextAllDay,
          ...(patch.attendees !== undefined
            ? { attendees: attendeesToJsonInput(patch.attendees) }
            : {}),
          ...(patch.reminderMinutes !== undefined
            ? { reminderMinutes: patch.reminderMinutes }
            : {}),
        },
      });
      pushTargetId = existingException.id;
    } else {
      const createdException = await prisma.event.create({
        data: {
          calendarId: patch.calendarId ?? master.calendarId,
          title: patch.title ?? master.title,
          description: (patch.description ?? master.description) || null,
          location: (patch.location ?? master.location) || null,
          locationPlaceId: resolveLocationPlaceId(patch, master.location, master.locationPlaceId),
          videoLink: (patch.videoLink ?? master.videoLink) || null,
          startAt: nextStart,
          endAt: nextEnd,
          allDay: nextAllDay,
          reminderMinutes: patch.reminderMinutes !== undefined ? patch.reminderMinutes : master.reminderMinutes,
          attendees:
            patch.attendees !== undefined
              ? attendeesToJsonInput(patch.attendees)
              : master.attendees === null
                ? Prisma.JsonNull
                : (master.attendees as Prisma.InputJsonValue),
          recurringEventId: master.id,
          originalStartAt,
          status: "CONFIRMED",
        },
      });
      pushTargetId = createdException.id;
    }
  }

  await dispatchPushBestEffort(pushTargetId, "update", master.calendar.provider);

  revalidatePath("/");
  revalidatePath("/agendas");

  return { ok: true, data: undefined };
}

// ── Actions ────────────────────────────────────────────────────────────

export async function createEvent(
  input: EventInput,
): Promise<ActionResult<{ eventId: string }>> {
  await requireSession();

  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const data = parsed.data;

  const range = parseAndValidateRange(data.start, data.end, data.allDay);
  if (!range.ok) return { ok: false, error: range.error };

  const calendar = await prisma.calendar.findUnique({ where: { id: data.calendarId } });
  if (!calendar) return { ok: false, error: "Agenda não encontrada" };
  if (calendar.isReadOnly) {
    return { ok: false, error: "Esta agenda é somente leitura no provedor" };
  }

  const rrule = data.recurrence ? buildRruleString(data.recurrence.freq) : null;

  const event = await prisma.event.create({
    data: {
      calendarId: data.calendarId,
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      locationPlaceId: data.locationPlaceId || null,
      videoLink: data.videoLink || null,
      startAt: range.start,
      endAt: range.end,
      allDay: data.allDay,
      attendees: data.attendees && data.attendees.length > 0 ? attendeesToJsonInput(data.attendees) : undefined,
      reminderMinutes: data.reminderMinutes ?? null,
      rrule,
    },
  });

  await dispatchPushBestEffort(event.id, "create", calendar.provider);

  if (data.location) {
    await refreshTravelInfo(event.id).catch((err) =>
      console.warn("[events] refreshTravelInfo falhou:", err),
    );
  }

  revalidatePath("/");
  revalidatePath("/agendas");

  return { ok: true, data: { eventId: event.id } };
}

export async function updateEvent(input: UpdateEventInput): Promise<ActionResult> {
  await requireSession();

  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  return applyScopedChange(
    parsed.data.eventId,
    parsed.data.occurrenceStart,
    parsed.data.scope,
    parsed.data.patch,
  );
}

export async function deleteEvent(input: DeleteEventInput): Promise<ActionResult> {
  await requireSession();

  const parsed = deleteEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  const targetEvent = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    include: { calendar: true },
  });
  if (!targetEvent) return { ok: false, error: "Evento não encontrado" };
  const master = await resolveScopeTarget(targetEvent, parsed.data.scope);
  if (master.calendar.isReadOnly) {
    return { ok: false, error: "Esta agenda é somente leitura no provedor" };
  }

  const originalStartAt = new Date(parsed.data.occurrenceStart);
  if (Number.isNaN(originalStartAt.getTime())) {
    return { ok: false, error: "Ocorrência inválida" };
  }

  // "Somente este" numa ocorrência já editada (linha de exceção): cancelar a
  // exceção — apagar a linha ressuscitaria o slot original da série.
  if (parsed.data.scope === "this" && master.recurringEventId) {
    await prisma.event.update({
      where: { id: master.id },
      data: { status: "CANCELLED" },
    });
    await dispatchPushBestEffort(master.id, "update", master.calendar.provider);

    revalidatePath("/");
    revalidatePath("/agendas");

    return { ok: true, data: undefined };
  }

  const isRecurringMaster = !!master.rrule;

  if (!isRecurringMaster || parsed.data.scope === "all") {
    // Push antes de apagar localmente: a linha some do banco e o provedor
    // ainda precisa dos dados dela (externalId) para excluir remotamente.
    await dispatchPushBestEffort(master.id, "delete", master.calendar.provider);
    await prisma.event.deleteMany({
      where: { OR: [{ id: master.id }, { recurringEventId: master.id }] },
    });
  } else {
    const existingException = await prisma.event.findFirst({
      where: { recurringEventId: master.id, originalStartAt },
    });

    let exceptionId: string;
    if (existingException) {
      await prisma.event.update({
        where: { id: existingException.id },
        data: { status: "CANCELLED" },
      });
      exceptionId = existingException.id;
    } else {
      const durationMs = master.endAt.getTime() - master.startAt.getTime();
      const createdException = await prisma.event.create({
        data: {
          calendarId: master.calendarId,
          title: master.title,
          description: master.description,
          location: master.location,
          videoLink: master.videoLink,
          startAt: originalStartAt,
          endAt: new Date(originalStartAt.getTime() + durationMs),
          allDay: master.allDay,
          reminderMinutes: master.reminderMinutes,
          recurringEventId: master.id,
          originalStartAt,
          status: "CANCELLED",
        },
      });
      exceptionId = createdException.id;
    }
    // A exceção CANCELLED permanece no banco; o provedor traduz para o
    // cancelamento da instância remota correspondente.
    await dispatchPushBestEffort(exceptionId, "update", master.calendar.provider);
  }

  revalidatePath("/");
  revalidatePath("/agendas");

  return { ok: true, data: undefined };
}

export async function moveEvent(input: MoveEventInput): Promise<ActionResult> {
  await requireSession();

  const parsed = moveEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  const start = new Date(parsed.data.newStart);
  const end = new Date(parsed.data.newEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return { ok: false, error: "Datas inválidas" };
  }

  return applyScopedChange(parsed.data.eventId, parsed.data.occurrenceStart, parsed.data.scope, {
    start: parsed.data.newStart,
    end: parsed.data.newEnd,
  });
}

/** Janela [start, end) em ISO UTC. */
export async function getOccurrences(input: {
  start: string;
  end: string;
}): Promise<OccurrenceDTO[]> {
  await requireSession();

  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) return [];

  const windowStart = new Date(parsed.data.start);
  const windowEnd = new Date(parsed.data.end);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) return [];

  return collectOccurrences(windowStart, windowEnd);
}

const UPCOMING_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

export async function getUpcomingEvents(limit = 3): Promise<OccurrenceDTO[]> {
  await requireSession();

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : 3;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_HORIZON_MS);

  const occurrences = await collectOccurrences(now, windowEnd);

  return occurrences
    .filter((o) => o.inviteStatus !== "NEEDS_ACTION")
    .filter((o) => new Date(o.start).getTime() >= now.getTime())
    .slice(0, safeLimit);
}
