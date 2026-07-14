"use client";

import { Car, ClockAlert, MapPin } from "lucide-react";
import { formatTime } from "@/lib/datetime";
import type { OccurrenceDTO } from "@/lib/types";
import { cn } from "@/lib/cn";

export interface EventCardProps {
  occurrence: OccurrenceDTO;
  onClick?: () => void;
  className?: string;
}

function formatKm(km: number): string {
  return km.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/**
 * Linha de evento (specs/05): barra na cor da agenda, título, horário e, no
 * máximo, uma terceira linha com local + viagem (distância/tempo de carro
 * ou tag de atraso) — nunca mais que 3 linhas, mesmo com atraso. Sem local
 * (travel só existe com local) a 3ª linha simplesmente não é renderizada.
 * Usada em "Próximos eventos" e nas solicitações. Clique abre o sheet de
 * detalhe.
 */
export function EventCard({ occurrence, onClick, className }: EventCardProps) {
  const timeLabel = occurrence.allDay
    ? "Dia inteiro"
    : `${formatTime(occurrence.start)} – ${formatTime(occurrence.end)}`;

  const lateByMin = occurrence.travel?.lateByMin ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-stretch gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-bg-subtle",
        className,
      )}
    >
      <span
        className="w-[3px] shrink-0 rounded-full"
        style={{ backgroundColor: occurrence.calendarColor }}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-ink-primary">{occurrence.title}</span>
        <span className="text-13 text-ink-muted">{timeLabel}</span>
        {occurrence.location && (
          <span className="flex min-w-0 items-center gap-1 text-13 text-ink-muted">
            <MapPin className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {occurrence.location}
              {occurrence.travel && ` · ${formatKm(occurrence.travel.distanceKm)} km`}
            </span>
            {occurrence.travel &&
              (lateByMin !== null ? (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-status-critical">
                  <ClockAlert className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  Atrasado {lateByMin} min
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <Car className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {occurrence.travel.durationMin} min
                </span>
              ))}
          </span>
        )}
      </span>
    </button>
  );
}
