// Outlook / Microsoft Graph — specs/07. Sync bidirecional via REST v1.0
// com fetch puro (sem SDK).
//
// Assinaturas CONGELADAS (push.ts e sync.ts dependem delas):
//   syncOutlookAccount, outlookPushEventChange, outlookRespondInvite.
//
// Funções puras de mapeamento (hexColorToSlot, graphDateTimeToUtc,
// graphRecurrenceToRrule, rruleToGraphRecurrence, mapGraphAttendees,
// mapInviteStatus, graphEventToLocalFields, localEventToGraphPayload) são
// exportadas para teste isolado.

import type { Calendar, Event } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { expandOccurrences } from "@/lib/recurrence";
import { CALENDAR_COLORS, TIMEZONE } from "@/lib/types";
import type { AttendeeDTO, InviteStatus } from "@/lib/types";
import { notifyNewInvite } from "./evolution";

// ── Constantes ────────────────────────────────────────────────────────────

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const OUTLOOK_AUTHORIZE_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const OUTLOOK_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const OUTLOOK_SCOPES = "offline_access Calendars.ReadWrite User.Read";

/** Todos os horários pedidos em UTC; páginas de 100 itens (specs/07). */
const PREFER_SYNC = 'odata.maxpagesize=100, outlook.timezone="UTC"';
const PREFER_UTC = 'outlook.timezone="UTC"';

const DAY_MS = 24 * 60 * 60 * 1000;
const SYNC_WINDOW_PAST_DAYS = 30;
const SYNC_WINDOW_FUTURE_DAYS = 365;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
const MAX_RETRY_AFTER_S = 60;
const MAX_429_RETRIES = 3;

// ── Tipos dos payloads do Graph ───────────────────────────────────────────

export interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone?: string;
}

interface GraphEmailAddress {
  address?: string;
  name?: string;
}

export interface GraphAttendee {
  emailAddress?: GraphEmailAddress;
  status?: { response?: string };
}

export interface GraphRecurrencePattern {
  type?: string;
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
  firstDayOfWeek?: string;
  index?: string;
}

export interface GraphRecurrenceRange {
  type?: string;
  startDate?: string;
  endDate?: string;
  numberOfOccurrences?: number;
  recurrenceTimeZone?: string;
}

export interface GraphRecurrence {
  pattern?: GraphRecurrencePattern;
  range?: GraphRecurrenceRange;
}

export interface GraphEvent {
  id?: string;
  "@removed"?: { reason?: string };
  type?: string; // singleInstance | occurrence | exception | seriesMaster
  seriesMasterId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  attendees?: GraphAttendee[];
  organizer?: { emailAddress?: GraphEmailAddress };
  responseStatus?: { response?: string };
  changeKey?: string;
  lastModifiedDateTime?: string;
  originalStart?: string;
  recurrence?: GraphRecurrence | null;
}

interface GraphCalendarItem {
  id?: string;
  name?: string;
  hexColor?: string | null;
  canEdit?: boolean;
}

interface GraphPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

// ── Mapeamentos puros (exportados para teste) ─────────────────────────────

/** Cor hex do provedor → hex do slot mais próximo de CALENDAR_COLORS (RGB). */
export function hexColorToSlot(hex: string | null | undefined): string {
  const fallback = CALENDAR_COLORS[0].hex;
  if (!hex) return fallback;
  const parsed = parseHex(hex);
  if (!parsed) return fallback;

  let best: string = fallback;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const slot of CALENDAR_COLORS) {
    const slotRgb = parseHex(slot.hex);
    if (!slotRgb) continue;
    const dist =
      (parsed[0] - slotRgb[0]) ** 2 +
      (parsed[1] - slotRgb[1]) ** 2 +
      (parsed[2] - slotRgb[2]) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = slot.hex;
    }
  }
  return best;
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const raw = match[1];
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

/** "2026-07-13T10:00:00.0000000" (frações de 7 dígitos do Graph) → parseável. */
function trimFraction(value: string): string {
  return value.replace(/(\.\d{3})\d+/, "$1");
}

/** Instante ISO do Graph (DateTimeOffset, com ou sem zona explícita). */
export function parseGraphInstant(value: string): Date {
  const raw = trimFraction(value.trim());
  return new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
}

/** `{ dateTime, timeZone }` do Graph → Date UTC. */
export function graphDateTimeToUtc(value: GraphDateTimeTimeZone): Date {
  const raw = trimFraction(value.dateTime.trim());
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) return new Date(raw);
  const tz = value.timeZone?.trim() || "UTC";
  if (/^utc$/i.test(tz)) return new Date(`${raw}Z`);
  if (tz.includes("/")) return fromZonedTime(raw, tz); // nome IANA
  // Nome Windows (não deveria ocorrer: pedimos Prefer outlook.timezone="UTC")
  console.warn(`[outlook] timeZone não reconhecido ("${tz}") — tratando como UTC`);
  return new Date(`${raw}Z`);
}

const GRAPH_DAY_BY_RRULE: Record<string, string> = {
  SU: "sunday",
  MO: "monday",
  TU: "tuesday",
  WE: "wednesday",
  TH: "thursday",
  FR: "friday",
  SA: "saturday",
};

const RRULE_DAY_BY_GRAPH: Record<string, string> = Object.fromEntries(
  Object.entries(GRAPH_DAY_BY_RRULE).map(([k, v]) => [v, k]),
);

/** ISO day (1=seg..7=dom) → dia do Graph. */
const GRAPH_DAY_BY_ISO_INDEX = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * `recurrence` do Graph → RRULE básica (specs/07). Padrões não
 * representáveis (relativeMonthly, relativeYearly, ...) → null; o chamador
 * cai no fallback de occurrences materializadas.
 */
export function graphRecurrenceToRrule(
  recurrence: GraphRecurrence | null | undefined,
): string | null {
  const pattern = recurrence?.pattern;
  const range = recurrence?.range;
  if (!pattern?.type) return null;

  const parts: string[] = [];
  switch (pattern.type) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekly": {
      parts.push("FREQ=WEEKLY");
      const days = (pattern.daysOfWeek ?? [])
        .map((d) => RRULE_DAY_BY_GRAPH[d.toLowerCase()])
        .filter((d): d is string => !!d);
      if (days.length > 0) parts.push(`BYDAY=${days.join(",")}`);
      break;
    }
    case "absoluteMonthly":
      parts.push("FREQ=MONTHLY");
      if (pattern.dayOfMonth) parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
      break;
    case "absoluteYearly":
      parts.push("FREQ=YEARLY");
      if (pattern.month) parts.push(`BYMONTH=${pattern.month}`);
      if (pattern.dayOfMonth) parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
      break;
    default:
      return null; // relativeMonthly etc. → fallback materializado
  }

  if (pattern.interval && pattern.interval > 1) {
    parts.push(`INTERVAL=${pattern.interval}`);
  }

  if (range?.type === "endDate" && range.endDate) {
    // UNTIL no espaço "fake local" da expansão (fim do dia na parede local).
    parts.push(`UNTIL=${range.endDate.replaceAll("-", "")}T235959Z`);
  } else if (range?.type === "numbered" && range.numberOfOccurrences) {
    parts.push(`COUNT=${range.numberOfOccurrences}`);
  }

  return parts.join(";");
}

const PUSHABLE_RRULE_KEYS = new Set([
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "WKST",
]);

/**
 * RRULE básica local → `recurrence` do Graph (inversa de
 * graphRecurrenceToRrule). Regras fora do subconjunto suportado → null
 * (o push então omite `recurrence` com aviso).
 */
export function rruleToGraphRecurrence(
  rrule: string,
  startAt: Date,
): GraphRecurrence | null {
  if (/DTSTART/i.test(rrule)) return null;
  const text = rrule.trim().replace(/^RRULE:/i, "");
  const fields = new Map<string, string>();
  for (const part of text.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    fields.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1));
  }
  for (const key of fields.keys()) {
    if (!PUSHABLE_RRULE_KEYS.has(key)) return null;
  }

  const interval = fields.has("INTERVAL") ? Number(fields.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1) return null;

  const localDayOfMonth = Number(formatInTimeZone(startAt, TIMEZONE, "d"));
  const localMonth = Number(formatInTimeZone(startAt, TIMEZONE, "M"));
  const localIsoDay = Number(formatInTimeZone(startAt, TIMEZONE, "i")); // 1=seg

  let pattern: GraphRecurrencePattern;
  switch (fields.get("FREQ")) {
    case "DAILY":
      if (fields.has("BYDAY") || fields.has("BYMONTHDAY") || fields.has("BYMONTH")) return null;
      pattern = { type: "daily", interval };
      break;
    case "WEEKLY": {
      if (fields.has("BYMONTHDAY") || fields.has("BYMONTH")) return null;
      let daysOfWeek: string[];
      const byday = fields.get("BYDAY");
      if (byday) {
        daysOfWeek = byday.split(",").map((d) => GRAPH_DAY_BY_RRULE[d.trim().toUpperCase()]);
        if (daysOfWeek.some((d) => !d)) return null; // prefixo numérico (2TU) etc.
      } else {
        daysOfWeek = [GRAPH_DAY_BY_ISO_INDEX[localIsoDay - 1]];
      }
      pattern = { type: "weekly", interval, daysOfWeek, firstDayOfWeek: "monday" };
      break;
    }
    case "MONTHLY": {
      if (fields.has("BYDAY") || fields.has("BYMONTH")) return null;
      const dayOfMonth = fields.has("BYMONTHDAY")
        ? Number(fields.get("BYMONTHDAY"))
        : localDayOfMonth;
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1) return null;
      pattern = { type: "absoluteMonthly", interval, dayOfMonth };
      break;
    }
    case "YEARLY": {
      if (fields.has("BYDAY")) return null;
      const dayOfMonth = fields.has("BYMONTHDAY")
        ? Number(fields.get("BYMONTHDAY"))
        : localDayOfMonth;
      const month = fields.has("BYMONTH") ? Number(fields.get("BYMONTH")) : localMonth;
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1) return null;
      if (!Number.isInteger(month) || month < 1 || month > 12) return null;
      pattern = { type: "absoluteYearly", interval, dayOfMonth, month };
      break;
    }
    default:
      return null;
  }

  const startDate = formatInTimeZone(startAt, TIMEZONE, "yyyy-MM-dd");
  let range: GraphRecurrenceRange;
  if (fields.has("COUNT")) {
    const count = Number(fields.get("COUNT"));
    if (!Number.isInteger(count) || count < 1) return null;
    range = { type: "numbered", startDate, numberOfOccurrences: count };
  } else if (fields.has("UNTIL")) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(fields.get("UNTIL") ?? "");
    if (!match) return null;
    range = { type: "endDate", startDate, endDate: `${match[1]}-${match[2]}-${match[3]}` };
  } else {
    range = { type: "noEnd", startDate };
  }
  range.recurrenceTimeZone = TIMEZONE;

  return { pattern, range };
}

/** Status do attendee do Graph → resposta do DTO (none|notResponded → needsAction). */
export function mapAttendeeResponse(response: string | undefined): AttendeeDTO["response"] {
  switch (response) {
    case "accepted":
    case "organizer":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    default:
      return "needsAction"; // none | notResponded | ausente
  }
}

export function mapGraphAttendees(attendees: GraphAttendee[] | undefined): AttendeeDTO[] {
  const result: AttendeeDTO[] = [];
  for (const attendee of attendees ?? []) {
    const email = attendee.emailAddress?.address;
    if (!email) continue;
    result.push({
      email,
      ...(attendee.emailAddress?.name ? { name: attendee.emailAddress.name } : {}),
      response: mapAttendeeResponse(attendee.status?.response),
    });
  }
  return result;
}

/** `responseStatus.response = notResponded` e `isOrganizer: false` → NEEDS_ACTION. */
export function mapInviteStatus(
  item: Pick<GraphEvent, "attendees" | "isOrganizer" | "responseStatus">,
): InviteStatus {
  if (!item.attendees || item.attendees.length === 0) return "NONE";
  if (item.isOrganizer) return "NONE";
  switch (item.responseStatus?.response) {
    case "notResponded":
      return "NEEDS_ACTION";
    case "declined":
      return "DECLINED";
    case "accepted":
    case "tentativelyAccepted":
      return "ACCEPTED";
    default:
      return "NONE";
  }
}

export interface GraphEventLocalFields {
  title: string;
  description: string | null;
  location: string | null;
  videoLink: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  status: "CONFIRMED" | "CANCELLED";
  inviteStatus: InviteStatus;
  organizerEmail: string | null;
  attendees: AttendeeDTO[];
  etag: string | null;
  externalUpdatedAt: Date | null;
}

/**
 * Campos comuns de um evento do Graph → colunas locais (specs/07).
 * All-day: o Graph normaliza para meia-noite UTC; guardamos a MESMA data de
 * calendário como meia-noite local (America/Sao_Paulo), a convenção usada
 * pelos eventos criados na UI (fim exclusivo).
 */
export function graphEventToLocalFields(item: GraphEvent): GraphEventLocalFields {
  if (!item.start?.dateTime || !item.end?.dateTime) {
    throw new Error(`[outlook] evento ${item.id ?? "?"} sem start/end`);
  }
  const allDay = item.isAllDay ?? false;
  const startAt = allDay
    ? fromZonedTime(`${item.start.dateTime.slice(0, 10)}T00:00:00`, TIMEZONE)
    : graphDateTimeToUtc(item.start);
  const endAt = allDay
    ? fromZonedTime(`${item.end.dateTime.slice(0, 10)}T00:00:00`, TIMEZONE)
    : graphDateTimeToUtc(item.end);

  const description =
    item.bodyPreview?.trim() ||
    (item.body?.contentType === "text" ? item.body.content?.trim() : null) ||
    null;

  return {
    title: item.subject?.trim() || "(Sem título)",
    description,
    location: item.location?.displayName?.trim() || null,
    videoLink: item.onlineMeeting?.joinUrl ?? item.onlineMeetingUrl ?? null,
    startAt,
    endAt,
    allDay,
    status: item.isCancelled ? "CANCELLED" : "CONFIRMED",
    inviteStatus: mapInviteStatus(item),
    organizerEmail: item.organizer?.emailAddress?.address ?? null,
    attendees: mapGraphAttendees(item.attendees),
    etag: item.changeKey ?? null,
    externalUpdatedAt: item.lastModifiedDateTime
      ? parseGraphInstant(item.lastModifiedDateTime)
      : null,
  };
}

export interface LocalEventForPush {
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  attendees: unknown;
  rrule?: string | null;
}

/** "2026-07-13T10:00:00" (sem zona) — combinado com timeZone: "UTC". */
function toGraphUtcDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/**
 * Evento local → corpo de POST/PATCH do Graph. `includeRecurrence: false`
 * para PATCH de instância (exceção). Observação: videoLink não é enviado —
 * onlineMeetingUrl é somente leitura no Graph.
 */
export function localEventToGraphPayload(
  event: LocalEventForPush,
  opts: { includeRecurrence: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    subject: event.title,
    body: { contentType: "text", content: event.description ?? "" },
    location: { displayName: event.location ?? "" },
    isAllDay: event.allDay,
  };

  if (event.allDay) {
    const startDate = formatInTimeZone(event.startAt, TIMEZONE, "yyyy-MM-dd");
    let endDate = formatInTimeZone(event.endAt, TIMEZONE, "yyyy-MM-dd");
    if (endDate <= startDate) {
      // Graph exige fim exclusivo de pelo menos 1 dia.
      endDate = formatInTimeZone(
        new Date(event.startAt.getTime() + DAY_MS),
        TIMEZONE,
        "yyyy-MM-dd",
      );
    }
    payload.start = { dateTime: `${startDate}T00:00:00`, timeZone: TIMEZONE };
    payload.end = { dateTime: `${endDate}T00:00:00`, timeZone: TIMEZONE };
  } else {
    payload.start = { dateTime: toGraphUtcDateTime(event.startAt), timeZone: "UTC" };
    payload.end = { dateTime: toGraphUtcDateTime(event.endAt), timeZone: "UTC" };
  }

  const attendees = Array.isArray(event.attendees)
    ? (event.attendees as AttendeeDTO[]).filter((a) => a && typeof a.email === "string")
    : [];
  if (attendees.length > 0) {
    payload.attendees = attendees.map((a) => ({
      emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
      type: "required",
    }));
  }

  if (opts.includeRecurrence) {
    if (event.rrule) {
      const recurrence = rruleToGraphRecurrence(event.rrule, event.startAt);
      if (recurrence) {
        payload.recurrence = recurrence;
      } else {
        console.warn(
          `[outlook] RRULE não mapeável para o Graph ("${event.rrule}") — recorrência não enviada`,
        );
      }
    } else {
      payload.recurrence = null;
    }
  }

  return payload;
}

// ── Tokens e graphFetch ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("[outlook] MS_CLIENT_ID/MS_CLIENT_SECRET não configurados");
  }
  return { clientId, clientSecret };
}

/** invalid_grant → limpar tokens; UI de /agendas passa a oferecer "Reconectar". */
async function disconnectAccount(accountId: string): Promise<void> {
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { accessToken: "", refreshToken: "", tokenExpiresAt: null },
  });
}

async function refreshAccessToken(accountId: string): Promise<string> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("[outlook] conta não encontrada");
  if (!account.refreshToken) {
    throw new Error("[outlook] conta desconectada — reconecte em /agendas");
  }
  const { clientId, clientSecret } = msCredentials();

  const res = await fetch(OUTLOOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(account.refreshToken),
      scope: OUTLOOK_SCOPES,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      await disconnectAccount(accountId);
      throw new Error(
        "[outlook] refresh token inválido (invalid_grant) — conta desconectada, reconecte em /agendas",
      );
    }
    throw new Error(`[outlook] falha ao renovar token: HTTP ${res.status} ${data.error ?? ""}`);
  }

  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: {
      accessToken: encryptSecret(data.access_token),
      ...(data.refresh_token ? { refreshToken: encryptSecret(data.refresh_token) } : {}),
      tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    },
  });

  return data.access_token;
}

async function getAccessToken(accountId: string, forceRefresh = false): Promise<string> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("[outlook] conta não encontrada");
  if (!account.accessToken || !account.refreshToken) {
    throw new Error("[outlook] conta desconectada — reconecte em /agendas");
  }
  const expiresSoon =
    !account.tokenExpiresAt ||
    account.tokenExpiresAt.getTime() < Date.now() + TOKEN_REFRESH_SKEW_MS;
  if (forceRefresh || expiresSoon) return refreshAccessToken(accountId);
  return decryptSecret(account.accessToken);
}

/**
 * fetch autenticado no Graph: injeta Bearer, renova token expirado, retry
 * 1x em 401 pós-refresh e respeita Retry-After em 429.
 */
export async function graphFetch(
  accountId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  let token = await getAccessToken(accountId);
  let refreshed = false;
  let retries429 = 0;

  for (;;) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      token = await getAccessToken(accountId, true);
      continue;
    }
    if (res.status === 429 && retries429 < MAX_429_RETRIES) {
      retries429 += 1;
      const raw = Number(res.headers.get("Retry-After") ?? "1");
      const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_RETRY_AFTER_S) : 1;
      await sleep(seconds * 1000);
      continue;
    }
    return res;
  }
}

async function graphError(op: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  return new Error(`[outlook] ${op}: HTTP ${res.status} ${text.slice(0, 300)}`);
}

// ── Importação de agendas ─────────────────────────────────────────────────

/**
 * GET /me/calendars → upsert de Calendar (provider OUTLOOK). Nome e cor
 * (hexColor → slot mais próximo) vêm do provedor só na criação — mantidos os
 * valores locais (escolhidos pelo usuário depois de conectar) em
 * reimportações. `canEdit: false` → Calendar.isReadOnly (bloqueia edição
 * local e marca as ocorrências como somente leitura).
 */
export async function importOutlookCalendars(accountId: string): Promise<void> {
  let url: string | null = "/me/calendars?$top=50";
  while (url) {
    const res = await graphFetch(accountId, url);
    if (!res.ok) throw await graphError("GET /me/calendars", res);
    const page = (await res.json()) as GraphPage<GraphCalendarItem>;

    for (const cal of page.value ?? []) {
      if (!cal.id) continue;
      const name = cal.name?.trim() || "Agenda Outlook";
      const isReadOnly = cal.canEdit === false;
      const existing = await prisma.calendar.findUnique({
        where: { accountId_externalId: { accountId, externalId: cal.id } },
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
            color: hexColorToSlot(cal.hexColor),
            provider: "OUTLOOK",
            accountId,
            externalId: cal.id,
            isReadOnly,
          },
        });
      }
    }
    url = page["@odata.nextLink"] ?? null;
  }
}

// ── Pull incremental (calendarView/delta) ─────────────────────────────────

interface MasterInfo {
  missing: boolean;
  materialized: boolean;
  localId: string | null;
}

interface SyncContext {
  accountId: string;
  calendar: Calendar;
  windowStart: Date;
  windowEnd: Date;
  fullResync: boolean;
  /** seriesMasterId → decisão tomada nesta rodada. */
  masterCache: Map<string, MasterInfo>;
  /** Ids de occurrences regulares ignoradas (limpeza de materializações antigas). */
  skippedOccurrenceIds: string[];
  /** @removed cujo id não bate com nenhuma linha local (occurrence regular apagada). */
  unknownRemovedIds: string[];
  /** externalIds vistos nesta rodada (purga pós full resync). */
  seenExternalIds: Set<string>;
}

function initialDeltaUrl(calendarExternalId: string, windowStart: Date, windowEnd: Date): string {
  const params = new URLSearchParams({
    startDateTime: windowStart.toISOString(),
    endDateTime: windowEnd.toISOString(),
  });
  return `/me/calendars/${encodeURIComponent(calendarExternalId)}/calendarView/delta?${params}`;
}

/** Pull incremental (delta) de todas as agendas da conta. */
export async function syncOutlookAccount(accountId: string): Promise<void> {
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    include: { calendars: true },
  });
  if (!account || account.provider !== "OUTLOOK") {
    throw new Error("[outlook] conta OUTLOOK não encontrada");
  }
  if (!account.accessToken || !account.refreshToken) {
    throw new Error("[outlook] conta desconectada — reconecte em /agendas");
  }

  const errors: string[] = [];
  for (const calendar of account.calendars) {
    if (!calendar.externalId) continue;
    try {
      await syncCalendar(accountId, calendar);
    } catch (err) {
      errors.push(
        `agenda "${calendar.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`[outlook] sync com falhas — ${errors.join("; ")}`);
  }

  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: new Date() },
  });
}

async function syncCalendar(accountId: string, calendar: Calendar): Promise<void> {
  const windowStart = new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * DAY_MS);
  const windowEnd = new Date(Date.now() + SYNC_WINDOW_FUTURE_DAYS * DAY_MS);

  const ctx: SyncContext = {
    accountId,
    calendar,
    windowStart,
    windowEnd,
    fullResync: !calendar.syncToken,
    masterCache: new Map(),
    skippedOccurrenceIds: [],
    unknownRemovedIds: [],
    seenExternalIds: new Set(),
  };

  let url = calendar.syncToken || initialDeltaUrl(calendar.externalId!, windowStart, windowEnd);
  let restarted = false;

  for (;;) {
    const res = await graphFetch(accountId, url, { headers: { Prefer: PREFER_SYNC } });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const expired = res.status === 410 || /syncState(NotFound|Invalid)/i.test(text);
      if (expired && !restarted) {
        // Delta expirado → full resync (specs/07).
        restarted = true;
        ctx.fullResync = true;
        ctx.masterCache.clear();
        ctx.skippedOccurrenceIds = [];
        ctx.unknownRemovedIds = [];
        ctx.seenExternalIds.clear();
        await prisma.calendar.update({ where: { id: calendar.id }, data: { syncToken: null } });
        url = initialDeltaUrl(calendar.externalId!, windowStart, windowEnd);
        continue;
      }
      throw new Error(`[outlook] delta: HTTP ${res.status} ${text.slice(0, 300)}`);
    }

    const page = (await res.json()) as GraphPage<GraphEvent>;
    for (const item of page.value ?? []) {
      await handleDeltaItem(ctx, item);
    }

    if (page["@odata.nextLink"]) {
      url = page["@odata.nextLink"];
      continue;
    }
    if (page["@odata.deltaLink"]) {
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: { syncToken: page["@odata.deltaLink"] },
      });
    }
    break;
  }

  // Occurrences regulares vistas agora: remover restos de (a) materializações
  // antigas (série voltou a ser representável) e (b) exceções locais cuja
  // instância remota voltou ao padrão da série.
  if (ctx.skippedOccurrenceIds.length > 0) {
    await prisma.event.deleteMany({
      where: {
        calendarId: calendar.id,
        externalId: { in: ctx.skippedOccurrenceIds },
      },
    });
  }

  if (ctx.unknownRemovedIds.length > 0) {
    await reconcileSeriesCancellations(ctx);
  }

  if (ctx.fullResync) {
    await purgeUnseenAfterFullResync(ctx);
  }
}

async function handleDeltaItem(ctx: SyncContext, item: GraphEvent): Promise<void> {
  if (!item.id) return;

  if (item["@removed"]) {
    await handleRemoved(ctx, item.id);
    return;
  }

  const type = item.type ?? "singleInstance";

  if (type === "singleInstance") {
    await upsertStandalone(ctx, item);
    return;
  }

  if (type === "seriesMaster") {
    // Defensivo: calendarView/delta normalmente não devolve mestres.
    await processMasterPayload(ctx, item);
    return;
  }

  // occurrence | exception
  const masterExternalId = item.seriesMasterId;
  if (!masterExternalId) {
    await upsertStandalone(ctx, item);
    return;
  }

  const master = await ensureMaster(ctx, masterExternalId);
  if (master.missing) return; // série sumiu; @removed do mestre cuida do resto

  if (master.materialized) {
    // Fallback: padrão não representável → cada instância vira evento avulso.
    await upsertStandalone(ctx, item);
    return;
  }

  if (type === "occurrence") {
    // Occurrence regular de série representável: a expansão local cobre.
    ctx.skippedOccurrenceIds.push(item.id);
    ctx.seenExternalIds.add(item.id);
    return;
  }

  await upsertException(ctx, item, master.localId!);
}

/** Busca (uma vez por rodada) o mestre da série e decide a estratégia. */
async function ensureMaster(ctx: SyncContext, masterExternalId: string): Promise<MasterInfo> {
  const cached = ctx.masterCache.get(masterExternalId);
  if (cached) return cached;

  const res = await graphFetch(
    ctx.accountId,
    `/me/events/${encodeURIComponent(masterExternalId)}`,
    { headers: { Prefer: PREFER_UTC } },
  );

  let info: MasterInfo;
  if (res.status === 404) {
    info = { missing: true, materialized: false, localId: null };
  } else if (!res.ok) {
    throw await graphError(`GET /me/events/${masterExternalId}`, res);
  } else {
    const master = (await res.json()) as GraphEvent;
    master.id = master.id ?? masterExternalId;
    info = await processMasterPayload(ctx, master);
  }

  ctx.masterCache.set(masterExternalId, info);
  return info;
}

async function processMasterPayload(ctx: SyncContext, master: GraphEvent): Promise<MasterInfo> {
  const externalId = master.id!;
  ctx.seenExternalIds.add(externalId);

  if (master.isCancelled) {
    await deleteLocalByExternalId(ctx, externalId);
    return { missing: true, materialized: false, localId: null };
  }

  const rrule = graphRecurrenceToRrule(master.recurrence);
  if (rrule) {
    const localId = await upsertGraphEvent(ctx, master, {
      rrule,
      recurringEventId: null,
      originalStartAt: null,
    });
    return { missing: false, materialized: false, localId };
  }

  // Padrão não representável (relativeMonthly etc.): não guardar o mestre;
  // as occurrences do delta são materializadas como eventos avulsos.
  const existing = await prisma.event.findUnique({
    where: { calendarId_externalId: { calendarId: ctx.calendar.id, externalId } },
  });
  if (existing) {
    await prisma.event.deleteMany({
      where: { OR: [{ id: existing.id }, { recurringEventId: existing.id }] },
    });
  }
  console.warn(
    `[outlook] recorrência não representável (${master.recurrence?.pattern?.type ?? "?"}) em "${master.subject ?? externalId}" — occurrences materializadas como avulsos`,
  );
  return { missing: false, materialized: true, localId: null };
}

function attendeesToJson(
  attendees: AttendeeDTO[],
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (attendees.length === 0) return Prisma.JsonNull;
  return attendees as unknown as Prisma.InputJsonValue;
}

interface UpsertExtras {
  rrule: string | null;
  recurringEventId: string | null;
  originalStartAt: Date | null;
}

/**
 * Upsert por [calendarId, externalId]. Remoto sobrescreve o local (última
 * escrita vence, como no specs/06). Convite novo NEEDS_ACTION → notifica.
 */
async function upsertGraphEvent(
  ctx: SyncContext,
  item: GraphEvent,
  extras: UpsertExtras,
  adoptRowId?: string,
): Promise<string> {
  const externalId = item.id!;
  const fields = graphEventToLocalFields(item);

  const existing =
    (await prisma.event.findUnique({
      where: { calendarId_externalId: { calendarId: ctx.calendar.id, externalId } },
    })) ??
    (adoptRowId ? await prisma.event.findUnique({ where: { id: adoptRowId } }) : null);

  const data = {
    title: fields.title,
    description: fields.description,
    location: fields.location,
    videoLink: fields.videoLink,
    startAt: fields.startAt,
    endAt: fields.endAt,
    allDay: fields.allDay,
    status: fields.status,
    inviteStatus: fields.inviteStatus,
    organizerEmail: fields.organizerEmail,
    attendees: attendeesToJson(fields.attendees),
    etag: fields.etag,
    externalUpdatedAt: fields.externalUpdatedAt,
    externalId,
    rrule: extras.rrule,
    recurringEventId: extras.recurringEventId,
    originalStartAt: extras.originalStartAt,
  };

  const row = existing
    ? await prisma.event.update({ where: { id: existing.id }, data })
    : await prisma.event.create({ data: { calendarId: ctx.calendar.id, ...data } });

  ctx.seenExternalIds.add(externalId);

  const isNewInvite =
    fields.inviteStatus === "NEEDS_ACTION" &&
    (!existing || existing.inviteStatus !== "NEEDS_ACTION");
  if (isNewInvite) {
    try {
      await notifyNewInvite(row.id);
    } catch (err) {
      console.warn("[outlook] notifyNewInvite falhou (ignorado):", err);
    }
  }

  return row.id;
}

async function upsertStandalone(ctx: SyncContext, item: GraphEvent): Promise<void> {
  await upsertGraphEvent(ctx, item, {
    rrule: null,
    recurringEventId: null,
    originalStartAt: null,
  });
}

async function upsertException(
  ctx: SyncContext,
  item: GraphEvent,
  masterLocalId: string,
): Promise<void> {
  const originalStartAt = item.originalStart
    ? parseGraphInstant(item.originalStart)
    : item.start
      ? graphDateTimeToUtc(item.start)
      : null;
  if (!originalStartAt) {
    throw new Error(`[outlook] exceção ${item.id ?? "?"} sem originalStart`);
  }

  // Adota exceção local pendente (criada por edição "this" cujo push ainda
  // não resolveu o id da instância remota), evitando duplicata.
  const pending = await prisma.event.findFirst({
    where: { recurringEventId: masterLocalId, originalStartAt, externalId: null },
  });

  await upsertGraphEvent(
    ctx,
    item,
    { rrule: null, recurringEventId: masterLocalId, originalStartAt },
    pending?.id,
  );
}

async function deleteLocalByExternalId(ctx: SyncContext, externalId: string): Promise<void> {
  const existing = await prisma.event.findUnique({
    where: { calendarId_externalId: { calendarId: ctx.calendar.id, externalId } },
  });
  if (!existing) return;
  await prisma.event.deleteMany({
    where: { OR: [{ id: existing.id }, { recurringEventId: existing.id }] },
  });
}

/** `@removed` → cancelamento: exceção CANCELLED se instância, delete se mestre/avulso. */
async function handleRemoved(ctx: SyncContext, externalId: string): Promise<void> {
  ctx.seenExternalIds.add(externalId);

  const existing = await prisma.event.findUnique({
    where: { calendarId_externalId: { calendarId: ctx.calendar.id, externalId } },
  });

  if (!existing) {
    // Provavelmente uma occurrence regular (nunca armazenada) apagada no
    // Outlook — reconciliada via /instances ao fim da rodada.
    ctx.unknownRemovedIds.push(externalId);
    return;
  }

  if (existing.recurringEventId) {
    await prisma.event.update({
      where: { id: existing.id },
      data: { status: "CANCELLED" },
    });
    return;
  }

  await prisma.event.deleteMany({
    where: { OR: [{ id: existing.id }, { recurringEventId: existing.id }] },
  });
}

/**
 * @removed de occurrence regular não é mapeável diretamente (não guardamos
 * ids de occurrences). Reconciliação: para cada mestre local, compara a
 * expansão local com GET /me/events/{id}/instances e cria exceções
 * CANCELLED para os slots que sumiram. Limitada ao número de @removed
 * desconhecidos da rodada (evita cancelamento em massa por divergência de
 * expansão).
 */
async function reconcileSeriesCancellations(ctx: SyncContext): Promise<void> {
  let budget = ctx.unknownRemovedIds.length;

  const masters = await prisma.event.findMany({
    where: {
      calendarId: ctx.calendar.id,
      rrule: { not: null },
      recurringEventId: null,
      externalId: { not: null },
      status: { not: "CANCELLED" },
    },
  });

  for (const master of masters) {
    if (budget <= 0) break;

    const remoteStarts = await fetchInstanceOriginalStarts(
      ctx.accountId,
      master.externalId!,
      ctx.windowStart,
      ctx.windowEnd,
    );
    if (!remoteStarts) continue;

    const slots = expandOccurrences(
      { startAt: master.startAt, endAt: master.endAt, rrule: master.rrule! },
      ctx.windowStart,
      ctx.windowEnd,
    );
    const exceptions = await prisma.event.findMany({
      where: { recurringEventId: master.id },
    });

    for (const slot of slots) {
      if (budget <= 0) break;
      const ms = slot.start.getTime();
      if (remoteStarts.has(ms)) continue;
      if (exceptions.some((e) => e.originalStartAt?.getTime() === ms)) continue;

      await prisma.event.create({
        data: {
          calendarId: master.calendarId,
          title: master.title,
          description: master.description,
          location: master.location,
          videoLink: master.videoLink,
          startAt: slot.start,
          endAt: slot.end,
          allDay: master.allDay,
          recurringEventId: master.id,
          originalStartAt: slot.start,
          status: "CANCELLED",
        },
      });
      budget -= 1;
    }
  }
}

/** Set com getTime() do originalStart (?? start) de cada instância remota. */
async function fetchInstanceOriginalStarts(
  accountId: string,
  masterExternalId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<Set<number> | null> {
  const params = new URLSearchParams({
    startDateTime: windowStart.toISOString(),
    endDateTime: windowEnd.toISOString(),
  });
  let url: string | null =
    `/me/events/${encodeURIComponent(masterExternalId)}/instances?${params}`;
  const starts = new Set<number>();

  while (url) {
    const res = await graphFetch(accountId, url, { headers: { Prefer: PREFER_SYNC } });
    if (!res.ok) {
      console.warn(
        `[outlook] GET /instances de ${masterExternalId} falhou: HTTP ${res.status}`,
      );
      return null;
    }
    const page = (await res.json()) as GraphPage<GraphEvent>;
    for (const item of page.value ?? []) {
      const original = item.originalStart
        ? parseGraphInstant(item.originalStart)
        : item.start
          ? graphDateTimeToUtc(item.start)
          : null;
      if (original) starts.add(original.getTime());
    }
    url = page["@odata.nextLink"] ?? null;
  }

  return starts;
}

/**
 * Após um full resync (primeira rodada ou delta expirado), remove linhas
 * OUTLOOK que não apareceram na enumeração e que deveriam ter aparecido
 * (dentro da janela). Exceções CANCELLED são preservadas — instâncias
 * apagadas não reaparecem na enumeração e o cancelamento continua válido.
 */
async function purgeUnseenAfterFullResync(ctx: SyncContext): Promise<void> {
  const rows = await prisma.event.findMany({
    where: { calendarId: ctx.calendar.id, externalId: { not: null } },
  });

  const inWindow = (d: Date) =>
    d.getTime() < ctx.windowEnd.getTime() && d.getTime() >= ctx.windowStart.getTime();

  for (const row of rows) {
    if (!row.externalId || ctx.seenExternalIds.has(row.externalId)) continue;

    if (row.recurringEventId) {
      if (row.status === "CANCELLED") continue;
      if (row.originalStartAt && inWindow(row.originalStartAt)) {
        await prisma.event.deleteMany({ where: { id: row.id } });
      }
      continue;
    }

    if (row.rrule) {
      const slots = expandOccurrences(
        { startAt: row.startAt, endAt: row.endAt, rrule: row.rrule },
        ctx.windowStart,
        ctx.windowEnd,
      );
      if (slots.length > 0) {
        await prisma.event.deleteMany({
          where: { OR: [{ id: row.id }, { recurringEventId: row.id }] },
        });
      }
      continue;
    }

    if (
      row.endAt.getTime() > ctx.windowStart.getTime() &&
      row.startAt.getTime() < ctx.windowEnd.getTime()
    ) {
      await prisma.event.deleteMany({ where: { id: row.id } });
    }
  }
}

// ── Push (contrato de push.ts) ────────────────────────────────────────────

async function loadOutlookCalendar(event: Event): Promise<{
  accountId: string;
  calendar: Calendar;
}> {
  const calendar = await prisma.calendar.findUnique({
    where: { id: event.calendarId },
    include: { account: true },
  });
  if (!calendar || calendar.provider !== "OUTLOOK" || !calendar.account) {
    throw new Error("[outlook] evento não pertence a uma agenda Outlook conectada");
  }
  if (!calendar.externalId) {
    throw new Error("[outlook] agenda Outlook sem externalId");
  }
  return { accountId: calendar.account.id, calendar };
}

function eventToPushShape(event: Event): LocalEventForPush {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    attendees: event.attendees,
    rrule: event.rrule,
  };
}

async function saveExternalRefs(eventId: string, remote: GraphEvent): Promise<void> {
  await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(remote.id ? { externalId: remote.id } : {}),
      etag: remote.changeKey ?? null,
      externalUpdatedAt: remote.lastModifiedDateTime
        ? parseGraphInstant(remote.lastModifiedDateTime)
        : null,
    },
  });
}

/**
 * Mesmo contrato de googlePushEventChange: `event` pode ser mestre, avulso
 * ou exceção (recurringEventId != null → opera na instância remota). Em
 * "delete" a linha ainda existe no banco (push.ts chama antes de apagar).
 */
export async function outlookPushEventChange(
  event: Event,
  kind: "create" | "update" | "delete",
): Promise<void> {
  const { accountId, calendar } = await loadOutlookCalendar(event);

  if (event.recurringEventId) {
    await pushExceptionChange(accountId, event, kind);
    return;
  }

  if (kind === "delete" || event.status === "CANCELLED") {
    if (!event.externalId) return; // nunca chegou ao Outlook
    const res = await graphFetch(
      accountId,
      `/me/events/${encodeURIComponent(event.externalId)}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) throw await graphError("DELETE /me/events", res);
    return;
  }

  const payload = localEventToGraphPayload(eventToPushShape(event), {
    includeRecurrence: true,
  });

  if (kind === "create" || !event.externalId) {
    const res = await graphFetch(
      accountId,
      `/me/calendars/${encodeURIComponent(calendar.externalId!)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: PREFER_UTC },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw await graphError("POST /me/calendars/{id}/events", res);
    await saveExternalRefs(event.id, (await res.json()) as GraphEvent);
    return;
  }

  const res = await graphFetch(
    accountId,
    `/me/events/${encodeURIComponent(event.externalId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: PREFER_UTC },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw await graphError("PATCH /me/events", res);
  await saveExternalRefs(event.id, (await res.json()) as GraphEvent);
}

/**
 * Exceção local → instância remota. Sem externalId próprio, localiza a
 * instância via GET .../instances?startDateTime&endDateTime pelo
 * originalStartAt. Status CANCELLED → DELETE da instância.
 */
async function pushExceptionChange(
  accountId: string,
  event: Event,
  kind: "create" | "update" | "delete",
): Promise<void> {
  let targetId = event.externalId;

  if (!targetId) {
    const master = await prisma.event.findUnique({
      where: { id: event.recurringEventId! },
    });
    if (!master?.externalId) {
      throw new Error("[outlook] exceção sem mestre sincronizado no Outlook");
    }
    if (!event.originalStartAt) {
      throw new Error("[outlook] exceção sem originalStartAt");
    }
    targetId = await resolveInstanceId(accountId, master.externalId, event.originalStartAt);
    if (!targetId) {
      throw new Error("[outlook] instância remota da exceção não encontrada");
    }
  }

  if (kind === "delete" || event.status === "CANCELLED") {
    const res = await graphFetch(accountId, `/me/events/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw await graphError("DELETE /me/events (instância)", res);
    }
    return;
  }

  const payload = localEventToGraphPayload(eventToPushShape(event), {
    includeRecurrence: false,
  });
  const res = await graphFetch(accountId, `/me/events/${encodeURIComponent(targetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: PREFER_UTC },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await graphError("PATCH /me/events (instância)", res);
  await saveExternalRefs(event.id, (await res.json()) as GraphEvent);
}

/** Localiza o id da instância remota cujo originalStart bate com a exceção. */
async function resolveInstanceId(
  accountId: string,
  masterExternalId: string,
  originalStartAt: Date,
): Promise<string | null> {
  const params = new URLSearchParams({
    startDateTime: new Date(originalStartAt.getTime() - DAY_MS).toISOString(),
    endDateTime: new Date(originalStartAt.getTime() + DAY_MS).toISOString(),
  });
  let url: string | null =
    `/me/events/${encodeURIComponent(masterExternalId)}/instances?${params}`;

  while (url) {
    const res = await graphFetch(accountId, url, { headers: { Prefer: PREFER_SYNC } });
    if (!res.ok) throw await graphError("GET /me/events/{id}/instances", res);
    const page = (await res.json()) as GraphPage<GraphEvent>;
    for (const item of page.value ?? []) {
      if (!item.id) continue;
      const original = item.originalStart
        ? parseGraphInstant(item.originalStart)
        : item.start
          ? graphDateTimeToUtc(item.start)
          : null;
      if (original && original.getTime() === originalStartAt.getTime()) return item.id;
    }
    url = page["@odata.nextLink"] ?? null;
  }
  return null;
}

/** POST /me/events/{id}/accept ou /decline com { sendResponse: true }. */
export async function outlookRespondInvite(
  event: Event,
  response: "ACCEPTED" | "DECLINED",
): Promise<void> {
  const { accountId } = await loadOutlookCalendar(event);
  if (!event.externalId) {
    throw new Error("[outlook] convite sem externalId — sincronize antes de responder");
  }
  const action = response === "ACCEPTED" ? "accept" : "decline";
  const res = await graphFetch(
    accountId,
    `/me/events/${encodeURIComponent(event.externalId)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendResponse: true }),
    },
  );
  if (!res.ok) throw await graphError(`POST /me/events/{id}/${action}`, res);
}
