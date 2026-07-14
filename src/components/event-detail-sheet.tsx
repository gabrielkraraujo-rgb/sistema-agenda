"use client";

import { useState } from "react";
import { Bell, CalendarClock, Car, ClockAlert, MapPin, Pencil, Trash2, Video } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { deleteEvent } from "@/server/actions/events";
import { respondInvite } from "@/server/actions/invites";
import { formatDayLong, formatTime } from "@/lib/datetime";
import type { AttendeeDTO, EditScope, OccurrenceDTO } from "@/lib/types";
import { cn } from "@/lib/cn";

export interface EventDetailSheetProps {
  occurrence: OccurrenceDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (occurrence: OccurrenceDTO) => void;
  /** Chamado após excluir ou responder um convite com sucesso. */
  onMutated: () => void;
}

const REMINDER_LABELS: Record<number, string> = {
  10: "10 minutos antes",
  30: "30 minutos antes",
  60: "1 hora antes",
  1440: "1 dia antes",
};

function reminderLabel(minutes: number | null): string {
  if (minutes === null) return "Sem lembrete";
  return REMINDER_LABELS[minutes] ?? `${minutes} minutos antes`;
}

function attendeeStatus(response: AttendeeDTO["response"]): { label: string; tone: BadgeTone } {
  switch (response) {
    case "accepted":
      return { label: "Aceitou", tone: "good" };
    case "declined":
      return { label: "Recusou", tone: "critical" };
    case "tentative":
      return { label: "Talvez", tone: "warning" };
    default:
      return { label: "Pendente", tone: "neutral" };
  }
}

/** Sheet de detalhe do evento — specs/05. */
export function EventDetailSheet({
  occurrence,
  open,
  onOpenChange,
  onEdit,
  onMutated,
}: EventDetailSheetProps) {
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [responding, setResponding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!occurrence) return null;

  const lateByMin = occurrence.travel?.lateByMin ?? null;
  const mapsHref = occurrence.location
    ? `https://maps.google.com/?q=${encodeURIComponent(occurrence.location)}`
    : null;
  const dateTimeLabel = occurrence.allDay
    ? `${formatDayLong(occurrence.start)} · Dia inteiro`
    : `${formatDayLong(occurrence.start)} · ${formatTime(occurrence.start)} – ${formatTime(occurrence.end)}`;

  async function handleDelete(scope: EditScope) {
    if (!occurrence) return;
    setDeleting(true);
    try {
      const result = await deleteEvent({
        eventId: occurrence.eventId,
        occurrenceStart: occurrence.start,
        scope,
      });
      if (!result.ok) {
        toast({ title: "Não foi possível excluir", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Evento excluído", variant: "success" });
      setDeleteDialogOpen(false);
      onOpenChange(false);
      onMutated();
    } catch (err) {
      toast({
        title: "Não foi possível excluir",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleRespond(response: "ACCEPTED" | "DECLINED") {
    if (!occurrence) return;
    setResponding(true);
    try {
      const result = await respondInvite({ eventId: occurrence.eventId, response });
      if (!result.ok) {
        toast({ title: "Não foi possível responder", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: response === "ACCEPTED" ? "Convite aceito" : "Convite recusado",
        variant: "success",
      });
      onOpenChange(false);
      onMutated();
    } catch (err) {
      toast({
        title: "Não foi possível responder",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "error",
      });
    } finally {
      setResponding(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={occurrence.title}>
        <div className="flex flex-col gap-5">
          {occurrence.inviteStatus === "NEEDS_ACTION" && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-hairline bg-bg-subtle p-2.5">
              <span className="flex-1 text-13 font-medium text-ink-primary">
                Você foi convidado para este evento
              </span>
              <Button
                variant="destructive"
                className="h-8 px-2.5 text-13"
                loading={responding}
                onClick={() => handleRespond("DECLINED")}
              >
                Recusar
              </Button>
              <Button
                variant="primary"
                className="h-8 px-2.5 text-13"
                loading={responding}
                onClick={() => handleRespond("ACCEPTED")}
              >
                Aceitar
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: occurrence.calendarColor }}
              aria-hidden="true"
            />
            <span className="text-13 text-ink-muted">{occurrence.calendarName}</span>
          </div>

          <div className="flex items-start gap-2 text-sm text-ink-secondary">
            <CalendarClock
              className="mt-0.5 size-4 shrink-0 text-ink-muted"
              strokeWidth={2}
              aria-hidden="true"
            />
            <span className="capitalize">{dateTimeLabel}</span>
          </div>

          {occurrence.location && (
            <div className="flex flex-col gap-1.5">
              <a
                href={mapsHref ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 text-sm text-accent hover:underline"
              >
                <MapPin className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {occurrence.location}
              </a>
              {occurrence.travel && (
                <span
                  className={cn(
                    "flex items-start gap-2 text-sm",
                    lateByMin !== null ? "font-medium text-status-critical" : "text-ink-muted",
                  )}
                >
                  {lateByMin !== null ? (
                    <>
                      <ClockAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                      Atrasado {lateByMin} min
                    </>
                  ) : (
                    <>
                      <Car className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                      {occurrence.travel.durationMin} min ·{" "}
                      {occurrence.travel.distanceKm.toLocaleString("pt-BR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      km
                    </>
                  )}
                </span>
              )}
            </div>
          )}

          {occurrence.videoLink && (
            <Button
              variant="secondary"
              onClick={() =>
                window.open(occurrence.videoLink ?? "", "_blank", "noopener,noreferrer")
              }
            >
              <Video className="size-4" strokeWidth={2} />
              Entrar na chamada
            </Button>
          )}

          {occurrence.description && (
            <p className="whitespace-pre-wrap text-sm text-ink-secondary">
              {occurrence.description}
            </p>
          )}

          {occurrence.attendees.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-13 font-medium text-ink-muted">Convidados</span>
              <ul className="flex flex-col gap-1.5">
                {occurrence.attendees.map((attendee) => {
                  const status = attendeeStatus(attendee.response);
                  return (
                    <li
                      key={attendee.email}
                      className="flex items-center justify-between gap-2 text-sm text-ink-secondary"
                    >
                      <span className="truncate">{attendee.name ?? attendee.email}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 text-13 text-ink-muted">
            <Bell className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {reminderLabel(occurrence.reminderMinutes)}
          </div>

          {!occurrence.readOnly && (
            <div className="flex items-center gap-2 border-t border-hairline pt-4">
              <Button variant="secondary" className="flex-1" onClick={() => onEdit(occurrence)}>
                <Pencil className="size-4" strokeWidth={2} />
                Editar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="size-4" strokeWidth={2} />
                Excluir
              </Button>
            </div>
          )}
        </div>
      </Sheet>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Excluir evento"
        description={
          occurrence.isRecurring
            ? "Este evento se repete. Excluir apenas esta ocorrência ou toda a série?"
            : "Tem certeza que deseja excluir este evento? Esta ação não pode ser desfeita."
        }
      >
        <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
          Cancelar
        </Button>
        {occurrence.isRecurring ? (
          <>
            <Button variant="destructive" loading={deleting} onClick={() => handleDelete("this")}>
              Somente este
            </Button>
            <Button variant="destructive" loading={deleting} onClick={() => handleDelete("all")}>
              Todos
            </Button>
          </>
        ) : (
          <Button variant="destructive" loading={deleting} onClick={() => handleDelete("all")}>
            Excluir
          </Button>
        )}
      </Dialog>
    </>
  );
}
