// Google Calendar — sync bidirecional (specs/06). Onda 3A.
//
// Assinaturas CONGELADAS (push.ts e sync.ts dependem delas):
//   syncGoogleAccount, googlePushEventChange, googleRespondInvite.
//
// Estrutura do módulo:
// - Funções puras de mapeamento (exportadas para teste): cor Google -> slot
//   da paleta, datas (timed/allDay), RRULE, attendees -> inviteStatus e o
//   evento completo nos dois sentidos (Google <-> modelo local).
// - getGoogleClient: OAuth2 com refresh automático (tokenExpiresAt < now+2min)
//   e tratamento de invalid_grant (limpa tokens => conta "desconectada").
// - importGoogleCalendars: calendarList.list -> upsert de Calendar.
// - syncGoogleAccount: pull incremental por agenda com syncToken (HTTP 410 =>
//   full resync na janela -30d/+365d) + notifyNewInvite em convites novos.
// - googlePushEventChange: create/update/delete de mestres e avulsos;
//   exceções de recorrência viram operação na instância remota
//   (events.instances; status CANCELLED = cancelar a instância).
//
// Convenções de dados:
// - allDay: meia-noite de America/Sao_Paulo em UTC, fim EXCLUSIVO — idêntico
//   ao formato do Google (start.date/end.date), então a conversão é direta.
// - rrule local sem o prefixo "RRULE:" (compatível com buildRruleString e
//   expandOccurrences); o prefixo é recolocado ao enviar para o Google.
// - Conflito de edição: o remoto sobrescreve o local no pull (última escrita
//   vence — specs/06; caso raro em uso pessoal).

// OAuth2Client precisa vir de googleapis-common (mesma cópia de
// google-auth-library usada pelos tipos de calendar_v3 — a cópia hoisted no
// topo de node_modules é outra versão e o TS trata as classes como
// incompatíveis). Credentials é interface estrutural: qualquer cópia serve.
import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "googleapis-common";
import type { Credentials } from "google-auth-library";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Prisma, type ConnectedAccount, type Event } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { notifyNewInvite } from "./evolution";
import { CALENDAR_COLORS, TIMEZONE } from "@/lib/types";
import type { AttendeeDTO, InviteStatus } from "@/lib/types";

// ── Constantes ────────────────────────────────────────────────────────────

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
];

const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const FULL_SYNC_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const FULL_SYNC_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 250;

type LocalEventStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

// ── Mapeamentos puros (exportados para teste) ─────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/** Slot da paleta CALENDAR_COLORS mais próximo do hex do Google (distância RGB). */
export function nearestCalendarColor(googleHex: string | null | undefined): string {
  const fallback = CALENDAR_COLORS[0].hex;
  if (!googleHex) return fallback;
  const rgb = hexToRgb(googleHex);
  if (!rgb) return fallback;

  let best: string = fallback;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of CALENDAR_COLORS) {
    const slot = hexToRgb(option.hex);
    if (!slot) continue;
    const distance =
      (rgb.r - slot.r) ** 2 + (rgb.g - slot.g) ** 2 + (rgb.b - slot.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option.hex;
    }
  }
  return best;
}

/** `recurrence` do Google (linhas RFC5545) -> RRULE local (sem "RRULE:"). */
export function googleRecurrenceToRrule(
  recurrence: string[] | null | undefined,
): string | null {
  if (!recurrence || recurrence.length === 0) return null;
  const line = recurrence.find((entry) => entry.toUpperCase().startsWith("RRULE"));
  if (!line) return null;
  const rule = line.replace(/^RRULE:/i, "").trim();
  return rule || null;
}

/** RRULE local -> array `recurrence` do Google (recoloca o prefixo). */
export function rruleToGoogleRecurrence(rrule: string | null): string[] | null {
  if (!rrule) return null;
  return [rrule.toUpperCase().startsWith("RRULE:") ? rrule : `RRULE:${rrule}`];
}

/**
 * EventDateTime do Google -> instante UTC. `date` (allDay) vira meia-noite
 * de America/Sao_Paulo, espelhando a convenção do event-form local; o fim
 * exclusivo do Google é armazenado como está (specs/06).
 */
export function googleDateToUtc(
  value: calendar_v3.Schema$EventDateTime | null | undefined,
): { date: Date; allDay: boolean } | null {
  if (!value) return null;
  if (value.date) {
    const date = fromZonedTime(`${value.date}T00:00:00`, TIMEZONE);
    return Number.isNaN(date.getTime()) ? null : { date, allDay: true };
  }
  if (value.dateTime) {
    const date = new Date(value.dateTime);
    return Number.isNaN(date.getTime()) ? null : { date, allDay: false };
  }
  return null;
}

/** Instante UTC local -> EventDateTime do Google. */
export function utcToGoogleDate(
  date: Date,
  allDay: boolean,
): calendar_v3.Schema$EventDateTime {
  if (allDay) {
    return { date: formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd") };
  }
  return { dateTime: date.toISOString(), timeZone: TIMEZONE };
}

/**
 * attendees do Google -> lista local + inviteStatus do próprio usuário:
 * self needsAction -> NEEDS_ACTION; self declined -> DECLINED; self presente
 * (accepted/tentative) -> ACCEPTED; sem attendees ou sem self -> NONE.
 */
export function googleAttendeesToLocal(
  attendees: calendar_v3.Schema$EventAttendee[] | null | undefined,
): { attendees: AttendeeDTO[] | null; inviteStatus: InviteStatus } {
  if (!attendees || attendees.length === 0) {
    return { attendees: null, inviteStatus: "NONE" };
  }

  const mapped: AttendeeDTO[] = [];
  for (const attendee of attendees) {
    if (!attendee.email) continue;
    const dto: AttendeeDTO = { email: attendee.email };
    if (attendee.displayName) dto.name = attendee.displayName;
    if (
      attendee.responseStatus === "accepted" ||
      attendee.responseStatus === "declined" ||
      attendee.responseStatus === "tentative" ||
      attendee.responseStatus === "needsAction"
    ) {
      dto.response = attendee.responseStatus;
    }
    mapped.push(dto);
  }

  const self = attendees.find((attendee) => attendee.self);
  let inviteStatus: InviteStatus = "NONE";
  if (self) {
    if (self.responseStatus === "needsAction") inviteStatus = "NEEDS_ACTION";
    else if (self.responseStatus === "declined") inviteStatus = "DECLINED";
    else inviteStatus = "ACCEPTED";
  }

  return { attendees: mapped.length > 0 ? mapped : null, inviteStatus };
}

/** attendees locais (JSON do Event) -> formato do Google. */
export function localAttendeesToGoogle(
  attendees: unknown,
): calendar_v3.Schema$EventAttendee[] {
  if (!Array.isArray(attendees)) return [];
  const result: calendar_v3.Schema$EventAttendee[] = [];
  for (const raw of attendees as AttendeeDTO[]) {
    if (!raw || typeof raw.email !== "string" || !raw.email) continue;
    result.push({
      email: raw.email,
      ...(raw.name ? { displayName: raw.name } : {}),
      ...(raw.response ? { responseStatus: raw.response } : {}),
    });
  }
  return result;
}

/** reminders do Google -> reminderMinutes local (menor popup; default => null). */
export function googleRemindersToMinutes(
  reminders: calendar_v3.Schema$Event["reminders"],
): number | null {
  if (!reminders || reminders.useDefault || !reminders.overrides?.length) return null;
  const popups = reminders.overrides.filter(
    (override) => override.method === "popup" && typeof override.minutes === "number",
  );
  if (popups.length === 0) return null;
  return Math.min(...popups.map((override) => override.minutes as number));
}

/** hangoutLink ou entry point de vídeo do conferenceData. */
export function googleVideoLink(
  item: Pick<calendar_v3.Schema$Event, "hangoutLink" | "conferenceData">,
): string | null {
  if (item.hangoutLink) return item.hangoutLink;
  const entry = item.conferenceData?.entryPoints?.find(
    (point) => point.entryPointType === "video" && point.uri,
  );
  return entry?.uri ?? null;
}

function googleStatusToLocal(status: string | null | undefined): LocalEventStatus {
  if (status === "tentative") return "TENTATIVE";
  if (status === "cancelled") return "CANCELLED";
  return "CONFIRMED";
}

const LOCAL_STATUS_TO_GOOGLE: Record<LocalEventStatus, string> = {
  CONFIRMED: "confirmed",
  TENTATIVE: "tentative",
  CANCELLED: "cancelled",
};

/** Campos locais mapeados de um item do Google (sem calendarId/ids locais). */
export interface MappedGoogleEvent {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  videoLink: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  status: LocalEventStatus;
  inviteStatus: InviteStatus;
  organizerEmail: string | null;
  attendees: AttendeeDTO[] | null;
  reminderMinutes: number | null;
  rrule: string | null;
  etag: string | null;
  externalUpdatedAt: Date | null;
  /** externalId do mestre quando o item é exceção de recorrência. */
  recurringExternalId: string | null;
  originalStartAt: Date | null;
}

/** Evento do Google -> campos do modelo local. null = item sem datas úteis. */
export function googleEventToLocal(
  item: calendar_v3.Schema$Event,
): MappedGoogleEvent | null {
  if (!item.id) return null;
  const start = googleDateToUtc(item.start);
  const end = googleDateToUtc(item.end);
  if (!start || !end) return null;

  const { attendees, inviteStatus } = googleAttendeesToLocal(item.attendees);

  return {
    externalId: item.id,
    title: item.summary?.trim() || "(sem título)",
    description: item.description || null,
    location: item.location || null,
    videoLink: googleVideoLink(item),
    startAt: start.date,
    endAt: end.date,
    allDay: start.allDay,
    status: googleStatusToLocal(item.status),
    inviteStatus,
    organizerEmail: item.organizer?.email ?? null,
    attendees,
    reminderMinutes: googleRemindersToMinutes(item.reminders),
    rrule: googleRecurrenceToRrule(item.recurrence),
    etag: item.etag ?? null,
    externalUpdatedAt: item.updated ? new Date(item.updated) : null,
    recurringExternalId: item.recurringEventId ?? null,
    originalStartAt: googleDateToUtc(item.originalStartTime)?.date ?? null,
  };
}

/** Subconjunto do Event necessário para montar o corpo enviado ao Google. */
export interface LocalEventForPush {
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  status: LocalEventStatus;
  attendees: unknown;
  reminderMinutes: number | null;
  rrule: string | null;
}

/**
 * Evento local -> corpo do Google (insert/patch). `includeRecurrence: false`
 * para operações em instâncias (o Google rejeita `recurrence` em exceções).
 * videoLink local não é enviado (hangoutLink é somente leitura no Google).
 */
export function localEventToGoogle(
  event: LocalEventForPush,
  options?: { includeRecurrence?: boolean },
): calendar_v3.Schema$Event {
  const includeRecurrence = options?.includeRecurrence ?? true;
  const body: calendar_v3.Schema$Event = {
    summary: event.title,
    description: event.description,
    location: event.location,
    start: utcToGoogleDate(event.startAt, event.allDay),
    end: utcToGoogleDate(event.endAt, event.allDay),
    status: LOCAL_STATUS_TO_GOOGLE[event.status],
    attendees: localAttendeesToGoogle(event.attendees),
    reminders:
      event.reminderMinutes != null
        ? {
            useDefault: false,
            overrides: [{ method: "popup", minutes: event.reminderMinutes }],
          }
        : { useDefault: true },
  };
  if (includeRecurrence) {
    body.recurrence = rruleToGoogleRecurrence(event.rrule);
  }
  return body;
}

// ── Helpers de erro HTTP (GaxiosError) ────────────────────────────────────

function httpStatus(err: unknown): number | null {
  const candidate = err as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [candidate?.status, candidate?.code, candidate?.response?.status]) {
    if (typeof value === "number") return value;
  }
  return null;
}

const isGone = (err: unknown) => httpStatus(err) === 410;
const isNotFound = (err: unknown) => {
  const status = httpStatus(err);
  return status === 404 || status === 410;
};
const isPreconditionFailed = (err: unknown) => httpStatus(err) === 412;

function isInvalidGrant(err: unknown): boolean {
  const candidate = err as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  };
  if (candidate?.response?.data?.error === "invalid_grant") return true;
  return (
    typeof candidate?.message === "string" && candidate.message.includes("invalid_grant")
  );
}

// ── OAuth2 client ─────────────────────────────────────────────────────────

function googleEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no .env");
  }
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/oauth/google/callback`,
  };
}

/** OAuth2Client sem credenciais — usado pelas rotas /api/oauth/google/*. */
export function createOAuthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = googleEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function persistCredentials(
  accountId: string,
  credentials: Credentials,
): Promise<void> {
  const data: Prisma.ConnectedAccountUpdateInput = {};
  if (credentials.access_token) data.accessToken = encryptSecret(credentials.access_token);
  if (credentials.refresh_token) {
    data.refreshToken = encryptSecret(credentials.refresh_token);
  }
  if (credentials.expiry_date) data.tokenExpiresAt = new Date(credentials.expiry_date);
  if (credentials.scope) data.scope = credentials.scope;
  if (Object.keys(data).length > 0) {
    await prisma.connectedAccount.update({ where: { id: accountId }, data });
  }
}

/** invalid_grant: apaga os tokens — a UI de /agendas passa a exigir reconexão. */
async function markAccountDisconnected(accountId: string): Promise<void> {
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { accessToken: "", refreshToken: "", tokenExpiresAt: null },
  });
}

/**
 * Client autenticado da conta: descriptografa tokens, faz refresh automático
 * quando `tokenExpiresAt` < now+2min (persistindo o novo access token e o
 * refresh token, se vier) e trata invalid_grant desconectando a conta.
 */
export async function getGoogleClient(
  accountId: string,
): Promise<{ auth: OAuth2Client; account: ConnectedAccount }> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  if (!account || account.provider !== "GOOGLE") {
    throw new Error("Conta Google não encontrada");
  }
  if (!account.accessToken || !account.refreshToken) {
    throw new Error(
      `Conta Google ${account.email} desconectada — reconecte em /agendas`,
    );
  }

  const auth = createOAuthClient();
  auth.setCredentials({
    access_token: decryptSecret(account.accessToken),
    refresh_token: decryptSecret(account.refreshToken),
    expiry_date: account.tokenExpiresAt?.getTime(),
  });

  const staleThreshold = Date.now() + TOKEN_REFRESH_MARGIN_MS;
  if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() < staleThreshold) {
    try {
      const { credentials } = await auth.refreshAccessToken();
      auth.setCredentials(credentials);
      await persistCredentials(account.id, credentials);
    } catch (err) {
      if (isInvalidGrant(err)) {
        await markAccountDisconnected(account.id);
        throw new Error(
          `Conta Google ${account.email} desconectada (invalid_grant) — reconecte em /agendas`,
        );
      }
      throw err;
    }
  }

  return { auth, account };
}

// ── Importação de agendas ─────────────────────────────────────────────────

/**
 * calendarList.list -> upsert de Calendar (provider GOOGLE). Nome e cor vêm
 * do provedor apenas na criação (mantidos os valores locais — escolhidos
 * pelo usuário depois de conectar — em reimportações). Agendas
 * somente-leitura (accessRole reader/freeBusyReader) também são importadas.
 */
export async function importGoogleCalendars(accountId: string): Promise<number> {
  const { auth } = await getGoogleClient(accountId);
  const api = google.calendar({ version: "v3", auth });

  let pageToken: string | undefined;
  let imported = 0;

  do {
    const res = await api.calendarList.list({ maxResults: PAGE_SIZE, pageToken });
    for (const entry of res.data.items ?? []) {
      if (!entry.id || entry.deleted) continue;
      const name = entry.summaryOverride || entry.summary || entry.id;
      const isReadOnly =
        entry.accessRole === "reader" || entry.accessRole === "freeBusyReader";

      const existing = await prisma.calendar.findUnique({
        where: { accountId_externalId: { accountId, externalId: entry.id } },
      });
      if (existing) {
        await prisma.calendar.update({
          where: { id: existing.id },
          data: { isReadOnly },
        });
      } else {
        await prisma.calendar.create({
          data: {
            name,
            color: nearestCalendarColor(entry.backgroundColor),
            provider: "GOOGLE",
            accountId,
            externalId: entry.id,
            isReadOnly,
          },
        });
      }
      imported += 1;
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return imported;
}

// ── Pull incremental ──────────────────────────────────────────────────────

function toRfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface PullTarget {
  id: string;
  externalId: string;
  syncToken: string | null;
}

async function listAllEvents(
  api: calendar_v3.Calendar,
  externalId: string,
  syncToken: string | null,
): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null }> {
  const items: calendar_v3.Schema$Event[] = [];
  let nextSyncToken: string | null = null;
  let pageToken: string | undefined;

  do {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: externalId,
      maxResults: PAGE_SIZE,
      singleEvents: false,
      showDeleted: true,
      pageToken,
    };
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      params.timeMin = toRfc3339(new Date(Date.now() - FULL_SYNC_PAST_MS));
      params.timeMax = toRfc3339(new Date(Date.now() + FULL_SYNC_FUTURE_MS));
    }

    const res = await api.events.list(params);
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) nextSyncToken = res.data.nextSyncToken ?? null;
  } while (pageToken);

  return { items, nextSyncToken };
}

function attendeesJson(
  attendees: AttendeeDTO[] | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return attendees && attendees.length > 0
    ? (attendees as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;
}

/** Instância cancelada no Google -> exceção CANCELLED local. */
async function upsertCancelledInstance(
  calendarId: string,
  item: calendar_v3.Schema$Event,
): Promise<void> {
  if (!item.id || !item.recurringEventId) return;
  const master = await prisma.event.findUnique({
    where: {
      calendarId_externalId: { calendarId, externalId: item.recurringEventId },
    },
  });
  if (!master) return; // mestre fora da janela/apagado — nada a cancelar

  const original = googleDateToUtc(item.originalStartTime)?.date;
  if (!original) return;

  const existing =
    (await prisma.event.findUnique({
      where: { calendarId_externalId: { calendarId, externalId: item.id } },
    })) ??
    (await prisma.event.findFirst({
      where: { recurringEventId: master.id, originalStartAt: original },
    }));

  const shared = {
    status: "CANCELLED" as const,
    recurringEventId: master.id,
    originalStartAt: original,
    externalId: item.id,
    etag: item.etag ?? null,
    externalUpdatedAt: item.updated ? new Date(item.updated) : null,
  };

  if (existing) {
    await prisma.event.update({ where: { id: existing.id }, data: shared });
  } else {
    const durationMs = master.endAt.getTime() - master.startAt.getTime();
    await prisma.event.create({
      data: {
        calendarId,
        title: master.title,
        startAt: original,
        endAt: new Date(original.getTime() + durationMs),
        allDay: master.allDay,
        ...shared,
      },
    });
  }
}

async function applyPulledItem(
  calendarId: string,
  item: calendar_v3.Schema$Event,
): Promise<void> {
  if (!item.id) return;

  if (item.status === "cancelled") {
    if (item.recurringEventId) {
      await upsertCancelledInstance(calendarId, item);
    } else {
      // Mestre/avulso apagado remotamente: remove o local + exceções.
      const local = await prisma.event.findUnique({
        where: { calendarId_externalId: { calendarId, externalId: item.id } },
      });
      if (local) {
        await prisma.event.deleteMany({
          where: { OR: [{ id: local.id }, { recurringEventId: local.id }] },
        });
      }
    }
    return;
  }

  const mapped = googleEventToLocal(item);
  if (!mapped) return;

  // Exceções (instâncias modificadas) apontam para o mestre local.
  let recurringLocalId: string | null = null;
  if (mapped.recurringExternalId) {
    const master = await prisma.event.findUnique({
      where: {
        calendarId_externalId: {
          calendarId,
          externalId: mapped.recurringExternalId,
        },
      },
    });
    if (!master) return; // exceção sem mestre local — ignora
    recurringLocalId = master.id;
  }

  const existing =
    (await prisma.event.findUnique({
      where: { calendarId_externalId: { calendarId, externalId: mapped.externalId } },
    })) ??
    // Exceção criada localmente (ainda sem externalId) para o mesmo slot.
    (recurringLocalId && mapped.originalStartAt
      ? await prisma.event.findFirst({
          where: {
            recurringEventId: recurringLocalId,
            originalStartAt: mapped.originalStartAt,
            externalId: null,
          },
        })
      : null);

  const data = {
    title: mapped.title,
    description: mapped.description,
    location: mapped.location,
    videoLink: mapped.videoLink,
    startAt: mapped.startAt,
    endAt: mapped.endAt,
    allDay: mapped.allDay,
    status: mapped.status,
    inviteStatus: mapped.inviteStatus,
    organizerEmail: mapped.organizerEmail,
    attendees: attendeesJson(mapped.attendees),
    reminderMinutes: mapped.reminderMinutes,
    rrule: mapped.rrule,
    recurringEventId: recurringLocalId,
    originalStartAt: mapped.originalStartAt,
    externalId: mapped.externalId,
    etag: mapped.etag,
    externalUpdatedAt: mapped.externalUpdatedAt,
  };

  if (existing) {
    // Última escrita vence: o remoto sobrescreve o local (specs/06).
    await prisma.event.update({ where: { id: existing.id }, data });
  } else {
    const created = await prisma.event.create({ data: { calendarId, ...data } });
    if (created.inviteStatus === "NEEDS_ACTION") {
      // Convite novo — notificação WhatsApp em melhor esforço (specs/09).
      try {
        await notifyNewInvite(created.id);
      } catch (err) {
        console.warn("[google] notifyNewInvite falhou:", err);
      }
    }
  }
}

/**
 * Pull de uma agenda: events.list com syncToken (410 => limpa o token e faz
 * full resync na janela -30d/+365d) e aplica os itens (mestres/avulsos antes
 * das exceções). Exportada para teste com API mockada.
 */
export async function pullGoogleCalendar(
  api: calendar_v3.Calendar,
  target: PullTarget,
): Promise<void> {
  let result: { items: calendar_v3.Schema$Event[]; nextSyncToken: string | null };
  try {
    result = await listAllEvents(api, target.externalId, target.syncToken);
  } catch (err) {
    if (!isGone(err) || !target.syncToken) throw err;
    await prisma.calendar.update({
      where: { id: target.id },
      data: { syncToken: null },
    });
    result = await listAllEvents(api, target.externalId, null);
  }

  // Mestres e avulsos primeiro — exceções dependem do mestre já existir.
  const ordered = [...result.items].sort(
    (a, b) => Number(Boolean(a.recurringEventId)) - Number(Boolean(b.recurringEventId)),
  );
  for (const item of ordered) {
    try {
      await applyPulledItem(target.id, item);
    } catch (err) {
      console.warn(`[google] item ${item.id ?? "?"} ignorado no pull:`, err);
    }
  }

  if (result.nextSyncToken) {
    await prisma.calendar.update({
      where: { id: target.id },
      data: { syncToken: result.nextSyncToken },
    });
  }
}

/** Pull incremental de todas as agendas da conta (syncToken). */
export async function syncGoogleAccount(accountId: string): Promise<void> {
  const { auth, account } = await getGoogleClient(accountId);
  const api = google.calendar({ version: "v3", auth });

  const calendars = await prisma.calendar.findMany({
    where: { accountId, provider: "GOOGLE", externalId: { not: null } },
  });

  let firstError: unknown = null;
  for (const calendar of calendars) {
    try {
      await pullGoogleCalendar(api, {
        id: calendar.id,
        externalId: calendar.externalId as string,
        syncToken: calendar.syncToken,
      });
    } catch (err) {
      console.warn(`[google] pull da agenda "${calendar.name}" falhou:`, err);
      firstError = firstError ?? err;
    }
  }
  if (firstError) throw firstError;

  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date() },
  });
}

// ── Push local -> Google ──────────────────────────────────────────────────

async function loadPushContext(event: Event) {
  const calendar = await prisma.calendar.findUnique({
    where: { id: event.calendarId },
  });
  if (
    !calendar ||
    calendar.provider !== "GOOGLE" ||
    !calendar.accountId ||
    !calendar.externalId
  ) {
    return null;
  }
  const { auth, account } = await getGoogleClient(calendar.accountId);
  return {
    api: google.calendar({ version: "v3", auth }),
    account,
    accountId: calendar.accountId,
    remoteCalendarId: calendar.externalId,
  };
}

function sendUpdatesFor(event: Pick<Event, "attendees">): string {
  return Array.isArray(event.attendees) && event.attendees.length > 0 ? "all" : "none";
}

/** Acha o id da instância remota pelo originalStartAt (events.instances). */
async function findInstanceId(
  api: calendar_v3.Calendar,
  remoteCalendarId: string,
  masterExternalId: string,
  originalStartAt: Date,
  allDay: boolean,
): Promise<string | null> {
  const originalStart = allDay
    ? formatInTimeZone(originalStartAt, TIMEZONE, "yyyy-MM-dd")
    : toRfc3339(originalStartAt);

  // 1a tentativa: filtro nativo por originalStart.
  try {
    const res = await api.events.instances({
      calendarId: remoteCalendarId,
      eventId: masterExternalId,
      originalStart,
      showDeleted: true,
      maxResults: 1,
    });
    const id = res.data.items?.[0]?.id;
    if (id) return id;
  } catch {
    // cai na varredura paginada abaixo
  }

  // 2a tentativa: varre as instâncias comparando o originalStartTime.
  let pageToken: string | undefined;
  do {
    const res = await api.events.instances({
      calendarId: remoteCalendarId,
      eventId: masterExternalId,
      showDeleted: true,
      maxResults: PAGE_SIZE,
      pageToken,
    });
    for (const instance of res.data.items ?? []) {
      const original = googleDateToUtc(instance.originalStartTime ?? instance.start);
      if (
        instance.id &&
        original &&
        original.date.getTime() === originalStartAt.getTime()
      ) {
        return instance.id;
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return null;
}

async function saveExternalRefs(
  eventId: string,
  data: calendar_v3.Schema$Event,
  fallbackExternalId?: string,
): Promise<void> {
  await prisma.event.update({
    where: { id: eventId },
    data: {
      externalId: data.id ?? fallbackExternalId,
      etag: data.etag ?? undefined,
      externalUpdatedAt: data.updated ? new Date(data.updated) : undefined,
    },
  });
}

/** Exceção local -> operação na instância remota correspondente. */
async function pushRecurrenceException(
  api: calendar_v3.Calendar,
  remoteCalendarId: string,
  event: Event,
  kind: "create" | "update" | "delete",
): Promise<void> {
  const master = await prisma.event.findUnique({
    where: { id: event.recurringEventId as string },
  });
  if (!master?.externalId || !event.originalStartAt) return;

  const instanceId =
    event.externalId ??
    (await findInstanceId(
      api,
      remoteCalendarId,
      master.externalId,
      event.originalStartAt,
      master.allDay,
    ));
  if (!instanceId) {
    throw new Error("Instância remota da exceção não encontrada no Google");
  }

  const sendUpdates = sendUpdatesFor(
    Array.isArray(event.attendees) && event.attendees.length > 0 ? event : master,
  );

  // Cancelamento da instância ("excluir só esta") ou delete da linha de exceção.
  if (kind === "delete" || event.status === "CANCELLED") {
    try {
      await api.events.delete({
        calendarId: remoteCalendarId,
        eventId: instanceId,
        sendUpdates,
      });
    } catch (err) {
      if (!isNotFound(err)) throw err; // instância já cancelada — ok
    }
    if (kind !== "delete") {
      await prisma.event.update({
        where: { id: event.id },
        data: { externalId: instanceId },
      });
    }
    return;
  }

  const res = await api.events.patch({
    calendarId: remoteCalendarId,
    eventId: instanceId,
    sendUpdates,
    requestBody: localEventToGoogle(event, { includeRecurrence: false }),
  });
  await saveExternalRefs(event.id, res.data, instanceId);
}

/**
 * Empurra a mudança de um evento local para o Google. `event` pode ser um
 * mestre, um avulso ou uma linha de exceção (recurringEventId != null —
 * traduzida para a instância remota via originalStartAt; status CANCELLED
 * cancela a instância). Para kind "delete", a linha ainda existe no banco
 * (o push acontece antes do delete local).
 */
export async function googlePushEventChange(
  event: Event,
  kind: "create" | "update" | "delete",
): Promise<void> {
  const context = await loadPushContext(event);
  if (!context) return;
  const { api, accountId, remoteCalendarId } = context;

  if (event.recurringEventId && event.originalStartAt) {
    await pushRecurrenceException(api, remoteCalendarId, event, kind);
    return;
  }

  const sendUpdates = sendUpdatesFor(event);

  if (kind === "delete") {
    if (!event.externalId) return; // nunca chegou ao Google
    try {
      await api.events.delete({
        calendarId: remoteCalendarId,
        eventId: event.externalId,
        sendUpdates,
      });
    } catch (err) {
      if (!isNotFound(err)) throw err; // já removido no Google — ok
    }
    return;
  }

  const requestBody = localEventToGoogle(event, { includeRecurrence: true });

  if (kind === "create" || !event.externalId) {
    const res = await api.events.insert({
      calendarId: remoteCalendarId,
      sendUpdates,
      requestBody,
    });
    await saveExternalRefs(event.id, res.data);
    return;
  }

  try {
    const res = await api.events.patch(
      {
        calendarId: remoteCalendarId,
        eventId: event.externalId,
        sendUpdates,
        requestBody,
      },
      event.etag ? { headers: { "If-Match": event.etag } } : undefined,
    );
    await saveExternalRefs(event.id, res.data, event.externalId);
  } catch (err) {
    if (isPreconditionFailed(err)) {
      // O evento mudou no Google desde o último pull (etag divergente):
      // dispara um pull em segundo plano e devolve erro claro (specs/06).
      void syncGoogleAccount(accountId).catch((pullErr) =>
        console.warn("[google] pull pós-412 falhou:", pullErr),
      );
      throw new Error("Evento mudou no Google. Sincronize e tente novamente.");
    }
    throw err;
  }
}

/** Responde o convite no Google: patch do attendee self (accepted/declined). */
export async function googleRespondInvite(
  event: Event,
  response: "ACCEPTED" | "DECLINED",
): Promise<void> {
  if (!event.externalId) {
    throw new Error("Convite sem vínculo com o Google (externalId ausente)");
  }
  const context = await loadPushContext(event);
  if (!context) {
    throw new Error("Agenda do convite não está vinculada a uma conta Google");
  }
  const { api, account, remoteCalendarId } = context;

  const remote = await api.events.get({
    calendarId: remoteCalendarId,
    eventId: event.externalId,
  });

  const responseStatus = response === "ACCEPTED" ? "accepted" : "declined";
  const selfEmail = account.email.toLowerCase();
  let found = false;
  const attendees = (remote.data.attendees ?? []).map((attendee) => {
    if (attendee.self || attendee.email?.toLowerCase() === selfEmail) {
      found = true;
      return { ...attendee, responseStatus };
    }
    return attendee;
  });
  if (!found) attendees.push({ email: account.email, responseStatus });

  const res = await api.events.patch({
    calendarId: remoteCalendarId,
    eventId: event.externalId,
    sendUpdates: "all",
    requestBody: { attendees },
  });

  await prisma.event.update({
    where: { id: event.id },
    data: {
      attendees: attendeesJson(googleAttendeesToLocal(res.data.attendees).attendees),
      etag: res.data.etag ?? undefined,
      externalUpdatedAt: res.data.updated ? new Date(res.data.updated) : undefined,
    },
  });
}
