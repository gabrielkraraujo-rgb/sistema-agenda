// Contratos compartilhados entre server actions e UI.
// Datas trafegam como ISO 8601 UTC (string); conversão para exibição em
// America/Sao_Paulo fica na borda da UI (src/lib/datetime.ts).

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type CalendarProvider = "LOCAL" | "GOOGLE" | "OUTLOOK";
export type InviteStatus = "NONE" | "NEEDS_ACTION" | "ACCEPTED" | "DECLINED";
export type EditScope = "this" | "all";
export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface CalendarDTO {
  id: string;
  name: string;
  color: string;
  provider: CalendarProvider;
  accountEmail: string | null;
  /** Conta conectada dona da agenda (null para agendas LOCAL). */
  accountId: string | null;
  isVisible: boolean;
  isDefault: boolean;
  /** Somente leitura no provedor (ex.: agenda compartilhada sem permissão de escrita) */
  isReadOnly: boolean;
  eventCount: number;
}

export interface AttendeeDTO {
  email: string;
  name?: string;
  response?: "accepted" | "declined" | "tentative" | "needsAction";
}

export interface TravelInfoDTO {
  durationMin: number;
  distanceKm: number;
  /** Minutos de atraso previstos; null = chega a tempo */
  lateByMin: number | null;
}

/** Uma ocorrência exibível (evento avulso ou instância de recorrente). */
export interface OccurrenceDTO {
  /** `${eventId}` para avulsos; `${eventId}_${startISO}` para instâncias */
  id: string;
  eventId: string;
  calendarId: string;
  calendarColor: string;
  calendarName: string;
  title: string;
  description: string | null;
  location: string | null;
  videoLink: string | null;
  start: string; // ISO UTC
  end: string; // ISO UTC
  allDay: boolean;
  inviteStatus: InviteStatus;
  organizerEmail: string | null;
  attendees: AttendeeDTO[];
  isRecurring: boolean;
  reminderMinutes: number | null;
  provider: CalendarProvider;
  travel: TravelInfoDTO | null;
  /** Somente leitura quando o provedor não permite edição (ex.: convite não aceito) */
  readOnly: boolean;
}

export interface EventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  /** placeId do Google (Places New) validado para `location` — specs/08. */
  locationPlaceId?: string | null;
  videoLink?: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  allDay: boolean;
  attendees?: AttendeeDTO[];
  reminderMinutes?: number | null;
  recurrence?: { freq: RecurrenceFreq } | null;
}

export interface UpdateEventInput {
  eventId: string;
  /** start original da ocorrência editada (identifica a instância) */
  occurrenceStart: string;
  scope: EditScope;
  patch: Partial<EventInput>;
}

export interface DeleteEventInput {
  eventId: string;
  occurrenceStart: string;
  scope: EditScope;
}

export interface ProfileUpdateInput {
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  /** placeId do Google (Places New) validado para `address` — specs/08. */
  addressPlaceId?: string | null;
}

/** Chaves de API: string não-vazia grava (criptografada), "" mantém a atual, null limpa. */
export interface SettingsUpdateInput {
  evolutionBaseUrl?: string | null;
  evolutionInstance?: string | null;
  evolutionApiKey?: string | null;
  whatsappTargetNumber?: string | null;
  googleMapsApiKey?: string | null;
  notifyDailySummary?: boolean;
  dailySummaryTime?: string;
  notifyEventReminder?: boolean;
  defaultReminderMinutes?: number;
  notifyNewInvite?: boolean;
  notifyLateAlert?: boolean;
}

export interface MoveEventInput {
  eventId: string;
  /** start original da ocorrência arrastada (identifica a instância) */
  occurrenceStart: string;
  newStart: string; // ISO UTC
  newEnd: string; // ISO UTC
  scope: EditScope;
}

export interface DashboardStatsDTO {
  todayCount: number;
  weekCount: number;
  pendingInviteCount: number;
}

export interface ProfileDTO {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  addressPlaceId: string | null;
  /** true quando `address` tem um placeId validado (Places New) — specs/08. */
  addressGeocoded: boolean;
}

/** Sugestão de endereço do Places API (New) Autocomplete — specs/08. */
export interface PlaceSuggestionDTO {
  placeId: string;
  description: string;
}

export interface SettingsDTO {
  evolutionBaseUrl: string | null;
  evolutionInstance: string | null;
  /** Nunca retornar a chave em claro; apenas indicar presença */
  evolutionApiKeySet: boolean;
  whatsappTargetNumber: string | null;
  googleMapsApiKeySet: boolean;
  notifyDailySummary: boolean;
  dailySummaryTime: string; // HH:mm
  notifyEventReminder: boolean;
  defaultReminderMinutes: number;
  notifyNewInvite: boolean;
  notifyLateAlert: boolean;
}

export interface ConnectedAccountDTO {
  id: string;
  provider: Exclude<CalendarProvider, "LOCAL">;
  email: string;
  calendarCount: number;
}

/** Cores permitidas para agendas — ordem fixa, ver specs/01. */
export const CALENDAR_COLORS = [
  { name: "Azul", hex: "#2a78d6" },
  { name: "Verde-água", hex: "#1baf7a" },
  { name: "Amarelo", hex: "#eda100" },
  { name: "Verde", hex: "#008300" },
  { name: "Violeta", hex: "#4a3aa7" },
  { name: "Vermelho", hex: "#e34948" },
  { name: "Magenta", hex: "#e87ba4" },
  { name: "Laranja", hex: "#eb6834" },
] as const;

export const TIMEZONE = "America/Sao_Paulo";
