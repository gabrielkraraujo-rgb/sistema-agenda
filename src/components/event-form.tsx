"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { addDays, subDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AddressAutocomplete,
  type AddressAutocompleteValue,
} from "@/components/ui/address-autocomplete";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createEvent, updateEvent } from "@/server/actions/events";
import { listCalendars } from "@/server/actions/calendars";
import { formatInTz } from "@/lib/datetime";
import {
  TIMEZONE,
  type AttendeeDTO,
  type CalendarDTO,
  type EventInput,
  type OccurrenceDTO,
  type RecurrenceFreq,
} from "@/lib/types";

export interface EventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = editando; ausente/null = criando um novo evento. */
  occurrence?: OccurrenceDTO | null;
  /** Chamado após criar/editar com sucesso (recarrega stats + calendário). */
  onSaved: () => void;
}

const REPEAT_OPTIONS: Array<{ value: "none" | RecurrenceFreq; label: string }> = [
  { value: "none", label: "Não repete" },
  { value: "DAILY", label: "Todo dia" },
  { value: "WEEKLY", label: "Toda semana" },
  { value: "MONTHLY", label: "Todo mês" },
  { value: "YEARLY", label: "Todo ano" },
];

const REMINDER_OPTIONS = [
  { value: "default", label: "Padrão" },
  { value: "none", label: "Sem lembrete" },
  { value: "10", label: "10 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 dia antes" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Parseia "yyyy-MM-dd" ou "yyyy-MM-ddTHH:mm" de forma agnóstica a timezone
 * (os componentes numéricos são lidos/gravados sempre no fuso do runtime,
 * usados aqui só como representação "crua" da parede de America/Sao_Paulo —
 * a conversão real de/para UTC acontece via toZonedTime/fromZonedTime). */
function parseLocal(value: string): Date {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoToLocalDateTime(iso: string): string {
  return formatInTz(iso, "yyyy-MM-dd'T'HH:mm");
}

/** Data de início (inclusive) de um evento de dia inteiro. */
function isoToLocalDateStart(iso: string): string {
  return formatInTz(iso, "yyyy-MM-dd");
}

/** Data de término exibida (inclusive) — `end` é armazenado exclusivo
 * (início do dia seguinte ao último dia do evento). */
function isoToLocalDateInclusiveEnd(iso: string): string {
  return formatInTz(subDays(new Date(iso), 1), "yyyy-MM-dd");
}

function localDateTimeToIso(value: string): string {
  return fromZonedTime(parseLocal(value), TIMEZONE).toISOString();
}

function localDateToIsoStart(value: string): string {
  return fromZonedTime(parseLocal(`${value}T00:00`), TIMEZONE).toISOString();
}

/** Converte a data de término (inclusive, escolhida no form) para o instante
 * exclusivo armazenado (início do dia seguinte). */
function localDateToIsoExclusiveEnd(value: string): string {
  const startOfDay = parseLocal(`${value}T00:00`);
  return fromZonedTime(addDays(startOfDay, 1), TIMEZONE).toISOString();
}

function buildDefaultStart(): Date {
  const zonedNow = toZonedTime(new Date(), TIMEZONE);
  zonedNow.setSeconds(0, 0);
  const remainder = zonedNow.getMinutes() % 15;
  if (remainder !== 0) zonedNow.setMinutes(zonedNow.getMinutes() + (15 - remainder));
  return zonedNow;
}

function reminderToSelectValue(minutes: number | null): string {
  if (minutes === null) return "none";
  if ([10, 30, 60, 1440].includes(minutes)) return String(minutes);
  return "default";
}

function reminderPatchValue(reminder: string): number | null | undefined {
  if (reminder === "default") return undefined;
  if (reminder === "none") return null;
  return Number(reminder);
}

/** Sheet de criação/edição de evento — specs/05. */
export function EventForm({ open, onOpenChange, occurrence, onSaved }: EventFormProps) {
  const { toast } = useToast();
  const isEditing = Boolean(occurrence);
  const isRecurringLocked = Boolean(occurrence?.isRecurring);

  const [calendars, setCalendars] = useState<CalendarDTO[]>([]);
  // Estado inicial `true` (não via effect): evita setState síncrono em
  // efeito — ver nota sobre a regra `react-hooks/set-state-in-effect` acima
  // do efeito de busca das agendas.
  const [calendarsLoading, setCalendarsLoading] = useState(true);

  // Os campos abaixo são inicializados a partir de `occurrence` (edição) ou
  // de defaults (criação) via inicializador preguiçoso do useState, e NÃO
  // por um efeito: o componente é remontado a cada abertura do sheet (a
  // parent passa uma `key` que muda por sessão — ver dashboard-client.tsx),
  // então o padrão "resetar estado quando uma prop muda" recomendado pelos
  // docs do React (usar `key` em vez de efeito) já resolve o reset sem
  // precisar de um efeito com setState síncrono.
  const [title, setTitle] = useState(() => occurrence?.title ?? "");
  const [calendarId, setCalendarId] = useState(() => occurrence?.calendarId ?? "");
  const [allDay, setAllDay] = useState(() => occurrence?.allDay ?? false);
  const [startLocal, setStartLocal] = useState(() => {
    if (occurrence) {
      return occurrence.allDay
        ? isoToLocalDateStart(occurrence.start)
        : isoToLocalDateTime(occurrence.start);
    }
    return formatLocalDateTime(buildDefaultStart());
  });
  const [endLocal, setEndLocal] = useState(() => {
    if (occurrence) {
      return occurrence.allDay
        ? isoToLocalDateInclusiveEnd(occurrence.end)
        : isoToLocalDateTime(occurrence.end);
    }
    return formatLocalDateTime(new Date(buildDefaultStart().getTime() + 60 * 60 * 1000));
  });
  const [repeat, setRepeat] = useState<"none" | RecurrenceFreq>("none");
  // OccurrenceDTO não expõe o placeId salvo (specs/08 só adiciona os campos
  // estritamente necessários) — o placeId começa "não selecionado" e só é
  // preenchido quando o usuário escolhe uma sugestão nesta sessão. Se o
  // texto não for tocado, `buildInput` omite `locationPlaceId` e o servidor
  // preserva o placeId já salvo (comparação textual em events.ts).
  const [location, setLocation] = useState<AddressAutocompleteValue>(() => ({
    text: occurrence?.location ?? "",
    placeId: null,
  }));
  const [videoLink, setVideoLink] = useState(() => occurrence?.videoLink ?? "");
  const [attendees, setAttendees] = useState<AttendeeDTO[]>(
    () => occurrence?.attendees.map((a) => ({ email: a.email, name: a.name })) ?? [],
  );
  const [attendeeInput, setAttendeeInput] = useState("");
  const [reminder, setReminder] = useState(() =>
    reminderToSelectValue(occurrence?.reminderMinutes ?? null),
  );
  const [description, setDescription] = useState(() => occurrence?.description ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);

  // Carrega as agendas (para o Select) ao montar. `calendarsLoading` começa
  // `true` no useState acima; só é desligado dentro do `.finally()` (uma
  // atualização assíncrona, fora do corpo síncrono do efeito), então este
  // efeito nunca chama setState diretamente na sua execução síncrona.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listCalendars()
      .then((data) => {
        if (cancelled) return;
        setCalendars(data);
        setCalendarId((current) => {
          if (current) return current;
          return data.find((c) => c.isDefault)?.id ?? data[0]?.id ?? "";
        });
      })
      .catch((err) => {
        console.warn("[event-form] listCalendars falhou:", err);
        if (!cancelled) setCalendars([]);
      })
      .finally(() => {
        if (!cancelled) setCalendarsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleAllDayChange(next: boolean) {
    setAllDay(next);
    setStartLocal((prev) => (prev ? (next ? prev.split("T")[0] : `${prev}T09:00`) : prev));
    setEndLocal((prev) => (prev ? (next ? prev.split("T")[0] : `${prev}T10:00`) : prev));
  }

  function handleStartChange(nextValue: string) {
    if (startLocal && endLocal) {
      const prevStart = parseLocal(startLocal);
      const prevEnd = parseLocal(endLocal);
      const durationMs = Math.max(prevEnd.getTime() - prevStart.getTime(), 0);
      const nextStart = parseLocal(nextValue);
      const nextEnd = new Date(nextStart.getTime() + durationMs);
      setEndLocal(allDay ? formatLocalDate(nextEnd) : formatLocalDateTime(nextEnd));
    }
    setStartLocal(nextValue);
  }

  function handleAttendeeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = attendeeInput.trim();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setErrors((prev) => ({ ...prev, attendeeInput: "E-mail inválido." }));
      return;
    }
    if (attendees.some((a) => a.email.toLowerCase() === value.toLowerCase())) {
      setAttendeeInput("");
      return;
    }
    setAttendees((prev) => [...prev, { email: value }]);
    setAttendeeInput("");
    setErrors((prev) => {
      const next = { ...prev };
      delete next.attendeeInput;
      return next;
    });
  }

  function removeAttendee(email: string) {
    setAttendees((prev) => prev.filter((a) => a.email !== email));
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Informe um título.";
    if (!calendarId) errs.calendarId = "Selecione uma agenda.";
    if (startLocal && endLocal) {
      const start = parseLocal(startLocal);
      const end = parseLocal(endLocal);
      if (allDay ? end.getTime() < start.getTime() : end.getTime() <= start.getTime()) {
        errs.end = allDay
          ? "A data de término deve ser igual ou depois do início."
          : "O fim deve ser depois do início.";
      }
    }
    return errs;
  }

  function buildInput(): EventInput {
    const startIso = allDay ? localDateToIsoStart(startLocal) : localDateTimeToIso(startLocal);
    const endIso = allDay ? localDateToIsoExclusiveEnd(endLocal) : localDateTimeToIso(endLocal);

    const input: EventInput = {
      calendarId,
      title: title.trim(),
      start: startIso,
      end: endIso,
      allDay,
      attendees: attendees.length > 0 ? attendees : undefined,
      reminderMinutes: reminderPatchValue(reminder),
      description: description.trim() || undefined,
      location: location.text.trim() || undefined,
      // Só envia locationPlaceId quando há uma seleção nesta sessão — se o
      // usuário não tocou no campo, o servidor mantém o placeId já salvo.
      locationPlaceId: location.placeId ?? undefined,
      videoLink: videoLink.trim() || undefined,
    };

    if (!isRecurringLocked) {
      input.recurrence = repeat === "none" ? null : { freq: repeat };
    }

    return input;
  }

  async function save(scope: "this" | "all" = "all") {
    setSubmitting(true);
    try {
      const result =
        isEditing && occurrence
          ? await updateEvent({
              eventId: occurrence.eventId,
              occurrenceStart: occurrence.start,
              scope,
              patch: buildInput(),
            })
          : await createEvent(buildInput());

      if (!result.ok) {
        toast({
          title: isEditing ? "Não foi possível salvar" : "Não foi possível criar o evento",
          description: result.error,
          variant: "error",
        });
        return;
      }

      toast({ title: isEditing ? "Evento atualizado" : "Evento criado", variant: "success" });
      setScopeDialogOpen(false);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({
        title: isEditing ? "Não foi possível salvar" : "Não foi possível criar o evento",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationErrors = validate();
    setErrors((prev) => ({ ...prev, ...validationErrors }));
    if (Object.keys(validationErrors).length > 0) return;

    if (isEditing && occurrence?.isRecurring) {
      setScopeDialogOpen(true);
      return;
    }
    void save("all");
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={isEditing ? "Editar evento" : "Novo evento"}
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <Input
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={errors.title}
            placeholder="Nome do evento"
          />

          <Select
            label="Agenda"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            error={errors.calendarId}
            disabled={calendarsLoading || calendars.length === 0}
          >
            {calendars.length === 0 && (
              <option value="">{calendarsLoading ? "Carregando…" : "Nenhuma agenda"}</option>
            )}
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id} style={{ color: cal.color }}>
                ● {cal.name}
                {cal.isDefault ? " (padrão)" : ""}
              </option>
            ))}
          </Select>

          <div className="flex items-center justify-between">
            <label htmlFor="event-form-all-day" className="text-13 font-medium text-ink-primary">
              Dia inteiro
            </label>
            <Switch id="event-form-all-day" checked={allDay} onCheckedChange={handleAllDayChange} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Início"
              type={allDay ? "date" : "datetime-local"}
              value={startLocal}
              onChange={(e) => handleStartChange(e.target.value)}
            />
            <Input
              label="Fim"
              type={allDay ? "date" : "datetime-local"}
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              error={errors.end}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Select
              label="Repetir"
              value={isRecurringLocked ? "locked" : repeat}
              onChange={(e) => setRepeat(e.target.value as "none" | RecurrenceFreq)}
              disabled={isRecurringLocked}
            >
              {isRecurringLocked && <option value="locked">Recorrente</option>}
              {REPEAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {isRecurringLocked && (
              <p className="text-13 text-ink-muted">
                Para alterar a repetição, exclua e crie novamente.
              </p>
            )}
          </div>

          <AddressAutocomplete
            label="Local"
            value={location}
            onChange={setLocation}
            placeholder="Endereço ou nome do local"
          />

          <Input
            label="Link de vídeo"
            value={videoLink}
            onChange={(e) => setVideoLink(e.target.value)}
            placeholder="https://…"
          />

          <div className="flex flex-col gap-1.5">
            <Input
              label="Convidados"
              value={attendeeInput}
              onChange={(e) => setAttendeeInput(e.target.value)}
              onKeyDown={handleAttendeeKeyDown}
              error={errors.attendeeInput}
              placeholder="E-mail e Enter"
            />
            {attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attendees.map((attendee) => (
                  <span
                    key={attendee.email}
                    className="flex items-center gap-1 rounded-full bg-bg-subtle py-1 pl-2.5 pr-1.5 text-13 text-ink-primary"
                  >
                    {attendee.email}
                    <button
                      type="button"
                      onClick={() => removeAttendee(attendee.email)}
                      aria-label={`Remover ${attendee.email}`}
                      className="flex size-4 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 ease-out hover:text-ink-primary"
                    >
                      <X className="size-3" strokeWidth={2} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <Select label="Lembrete" value={reminder} onChange={(e) => setReminder(e.target.value)}>
            {REMINDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <Textarea
            label="Descrição"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" className="flex-1" loading={submitting}>
              Salvar
            </Button>
          </div>
        </form>
      </Sheet>

      <Dialog
        open={scopeDialogOpen}
        onOpenChange={setScopeDialogOpen}
        title="Evento recorrente"
        description="Aplicar as alterações somente a esta ocorrência ou a toda a série?"
      >
        <Button variant="ghost" onClick={() => setScopeDialogOpen(false)}>
          Cancelar
        </Button>
        <Button variant="secondary" loading={submitting} onClick={() => void save("this")}>
          Somente este
        </Button>
        <Button variant="primary" loading={submitting} onClick={() => void save("all")}>
          Todos
        </Button>
      </Dialog>
    </>
  );
}
