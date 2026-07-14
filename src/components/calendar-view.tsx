"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import type {
  DatesSetArg,
  EventChangeArg,
  EventClickArg,
  EventContentArg,
  EventInput as FcEventInput,
} from "@fullcalendar/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { fromZonedTime } from "date-fns-tz";
import { getOccurrences, moveEvent } from "@/server/actions/events";
import { formatInTz } from "@/lib/datetime";
import { TIMEZONE, type EditScope, type OccurrenceDTO } from "@/lib/types";
import { cn } from "@/lib/cn";
import "./calendar-view.css";

export type CalendarViewKey = "hoje" | "semana" | "mes";

export interface CalendarViewHandle {
  /** Muda a view exibida (usado pelos stat tiles "Eventos hoje"/"Nesta semana"). */
  setView: (view: CalendarViewKey) => void;
  /** Recarrega a janela visível atual (usado após criar/editar/excluir evento). */
  refetch: () => void;
}

export interface CalendarViewProps {
  onSelectOccurrence: (occurrence: OccurrenceDTO) => void;
  /**
   * Chave de localStorage para persistir a última view — o dashboard e a
   * página `/calendario` guardam a preferência separadamente (specs/05).
   */
  storageKey?: string;
  /** Altura repassada ao FullCalendar: "auto" (dashboard) ou "100%" para
   * preencher a viewport (`/calendario` — o container precisa ter altura
   * definida via flex para "100%" funcionar). */
  height?: string | number;
  className?: string;
}

const DEFAULT_STORAGE_KEY = "agenda:calendar-view";

const FC_VIEW_BY_KEY: Record<CalendarViewKey, string> = {
  hoje: "timeGridDay",
  semana: "timeGridWeek",
  mes: "dayGridMonth",
};

const VIEW_OPTIONS: SegmentedControlOption<CalendarViewKey>[] = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
];

function readStoredView(storageKey: string): CalendarViewKey | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(storageKey);
  return stored === "hoje" || stored === "semana" || stored === "mes" ? stored : null;
}

/**
 * View inicial: persistida em localStorage (chave própria por instância —
 * dashboard e `/calendario` não compartilham preferência); sem valor salvo,
 * Hoje no mobile e Semana no desktop (specs/05). Roda de forma segura no
 * servidor (o valor só é de fato usado depois de `mounted` virar true, ver
 * `useMounted`).
 */
function readInitialView(storageKey: string): CalendarViewKey {
  const stored = readStoredView(storageKey);
  if (stored) return stored;
  if (typeof window === "undefined") return "semana";
  return window.innerWidth < 768 ? "hoje" : "semana";
}

const noopSubscribe = () => () => {};

/** Evita montar o FullCalendar no servidor (depende de `window`/localStorage). */
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

interface PendingMove {
  occurrence: OccurrenceDTO;
  newStart: string;
  newEnd: string;
  revert: () => void;
}

// O FullCalendar só entende timezones nomeados com um plugin dedicado; sem
// ele, opera em "UTC coercion": strings SEM offset são exibidas literalmente
// e os Dates que ele devolve carregam a parede nos campos UTC. Alimentamos o
// FC com a parede de America/Sao_Paulo (via formatInTz) e convertemos de
// volta para instantes UTC reais com fromZonedTime — independente do fuso do
// navegador ou do servidor.

/** Instante UTC (ISO) → parede de America/Sao_Paulo, sem offset, para o FC. */
function isoToFcWall(iso: string): string {
  return formatInTz(iso, "yyyy-MM-dd'T'HH:mm:ss");
}

/** Date devolvido pelo FC (parede nos campos UTC) → instante UTC real (ISO). */
function fcDateToUtcIso(date: Date): string {
  const wall = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
  return fromZonedTime(wall, TIMEZONE).toISOString();
}

function toEventInput(occurrence: OccurrenceDTO): FcEventInput {
  const needsAction = occurrence.inviteStatus === "NEEDS_ACTION";
  return {
    id: occurrence.id,
    title: occurrence.title,
    start: isoToFcWall(occurrence.start),
    end: isoToFcWall(occurrence.end),
    allDay: occurrence.allDay,
    editable: !occurrence.readOnly,
    backgroundColor: `color-mix(in srgb, ${occurrence.calendarColor} 12%, white)`,
    borderColor: needsAction ? occurrence.calendarColor : "transparent",
    classNames: [
      ...(needsAction ? ["fc-event-needs-action"] : []),
      ...(occurrence.readOnly ? ["fc-event-readonly"] : []),
    ],
    extendedProps: { occurrence },
  };
}

function renderEventContent(arg: EventContentArg) {
  const occurrence = arg.event.extendedProps.occurrence as OccurrenceDTO;
  const color = occurrence.calendarColor;

  if (arg.view.type === "dayGridMonth") {
    return (
      <div className="flex min-w-0 items-center gap-1.5 px-1 py-0.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate text-[12px] leading-tight text-ink-primary">
          {occurrence.title}
        </span>
      </div>
    );
  }

  // Com os slots de meia hora reduzidos (specs/05 — ponto 3, ~metade da
  // altura), um evento de 30/45 min não tem altura para título + horário em
  // duas linhas sem cortar texto — mostra só o título nesse caso.
  const durationMin =
    arg.event.start && arg.event.end
      ? (arg.event.end.getTime() - arg.event.start.getTime()) / 60000
      : Infinity;
  const showTime = !occurrence.allDay && arg.timeText && durationMin > 45;

  return (
    <div className="relative flex h-full min-w-0 flex-col gap-0.5 overflow-hidden py-0.5 pl-2.5 pr-1">
      <span
        className="absolute inset-y-0.5 left-0 w-[3px] rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="truncate text-13 font-medium leading-tight text-ink-primary">
        {occurrence.title}
      </span>
      {showTime && (
        <span className="truncate text-[11px] leading-tight text-ink-secondary">
          {arg.timeText}
        </span>
      )}
    </div>
  );
}

export const CalendarView = forwardRef<CalendarViewHandle, CalendarViewProps>(
  function CalendarView(
    { onSelectOccurrence, storageKey = DEFAULT_STORAGE_KEY, height = "auto", className },
    ref,
  ) {
    const mounted = useMounted();
    const router = useRouter();
    const { toast } = useToast();
    const fcRef = useRef<FullCalendar | null>(null);
    const rangeRef = useRef<{ start: string; end: string } | null>(null);

    const [view, setViewState] = useState<CalendarViewKey>(() => readInitialView(storageKey));
    const [title, setTitle] = useState("");
    const [occurrences, setOccurrences] = useState<OccurrenceDTO[]>([]);
    const [loading, setLoading] = useState(false);
    const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

    const fetchRange = useCallback(async (start: string, end: string) => {
      rangeRef.current = { start, end };
      setLoading(true);
      try {
        const data = await getOccurrences({ start, end });
        // Ignora resposta obsoleta se a janela mudou enquanto a busca corria.
        if (rangeRef.current?.start === start && rangeRef.current?.end === end) {
          setOccurrences(data);
        }
      } catch (err) {
        console.warn("[calendar-view] getOccurrences falhou:", err);
        if (rangeRef.current?.start === start && rangeRef.current?.end === end) {
          setOccurrences([]);
        }
      } finally {
        setLoading(false);
      }
    }, []);

    const applyView = useCallback(
      (next: CalendarViewKey) => {
        setViewState(next);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, next);
        }
        fcRef.current?.getApi().changeView(FC_VIEW_BY_KEY[next]);
      },
      [storageKey],
    );

    useImperativeHandle(
      ref,
      () => ({
        setView: applyView,
        refetch: () => {
          if (rangeRef.current) {
            void fetchRange(rangeRef.current.start, rangeRef.current.end);
          }
        },
      }),
      [applyView, fetchRange],
    );

    const handleDatesSet = useCallback(
      (arg: DatesSetArg) => {
        setTitle(arg.view.title);
        // arg.start/end vêm em "parede coercida" do FC — converter para
        // instantes UTC reais antes de consultar o servidor.
        void fetchRange(fcDateToUtcIso(arg.start), fcDateToUtcIso(arg.end));
      },
      [fetchRange],
    );

    const commitMove = useCallback(
      async (
        occurrence: OccurrenceDTO,
        newStart: string,
        newEnd: string,
        scope: EditScope,
        revert: () => void,
      ) => {
        try {
          const result = await moveEvent({
            eventId: occurrence.eventId,
            occurrenceStart: occurrence.start,
            newStart,
            newEnd,
            scope,
          });
          if (!result.ok) {
            revert();
            toast({
              title: "Não foi possível mover o evento",
              description: result.error,
              variant: "error",
            });
            return;
          }
          router.refresh();
          if (rangeRef.current) {
            void fetchRange(rangeRef.current.start, rangeRef.current.end);
          }
        } catch (err) {
          revert();
          toast({
            title: "Não foi possível mover o evento",
            description: err instanceof Error ? err.message : "Tente novamente.",
            variant: "error",
          });
        }
      },
      [fetchRange, router, toast],
    );

    const handleEventChange = useCallback(
      (info: EventChangeArg) => {
        const occurrence = info.event.extendedProps.occurrence as OccurrenceDTO;
        const newStart = info.event.start ? fcDateToUtcIso(info.event.start) : occurrence.start;
        const newEnd = info.event.end ? fcDateToUtcIso(info.event.end) : occurrence.end;

        if (occurrence.isRecurring) {
          setPendingMove({ occurrence, newStart, newEnd, revert: info.revert });
        } else {
          void commitMove(occurrence, newStart, newEnd, "all", info.revert);
        }
      },
      [commitMove],
    );

    const handleEventClick = useCallback(
      (info: EventClickArg) => {
        const occurrence = info.event.extendedProps.occurrence as OccurrenceDTO;
        onSelectOccurrence(occurrence);
      },
      [onSelectOccurrence],
    );

    const events = occurrences.map(toEventInput);
    // Fora do modo "auto" (dashboard) o container precisa ocupar toda a
    // altura disponível para o FullCalendar preencher via height="100%"
    // (ex.: `/calendario`, cujo pai já reserva a altura da viewport).
    const filling = height !== "auto";

    return (
      <div className={cn("flex flex-col gap-3", filling && "h-full min-h-0", className)}>
        {!mounted ? (
          // O toolbar depende de `view` (persistido em localStorage /
          // largura da janela), que só pode ser lido no cliente — manter
          // TUDO isso (toolbar + grade) atrás do gate `mounted` evita
          // divergência entre o HTML da primeira renderização do servidor
          // e a primeira renderização do cliente (mismatch de hidratação).
          <Skeleton className="h-12 w-full rounded-full sm:w-64" />
        ) : (
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              aria-label="Visualização do calendário"
              options={VIEW_OPTIONS}
              value={view}
              onChange={applyView}
            />
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <span className="order-2 truncate text-13 font-medium capitalize text-ink-secondary sm:order-1">
                {title}
              </span>
              <div className="order-1 inline-flex items-center gap-0.5 sm:order-2">
                <button
                  type="button"
                  aria-label="Período anterior"
                  onClick={() => fcRef.current?.getApi().prev()}
                  className="flex size-8 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-ink-primary"
                >
                  <ChevronLeft className="size-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => fcRef.current?.getApi().today()}
                  className="rounded-full px-2.5 py-1 text-13 font-medium text-ink-secondary transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-ink-primary"
                >
                  Hoje
                </button>
                <button
                  type="button"
                  aria-label="Próximo período"
                  onClick={() => fcRef.current?.getApi().next()}
                  className="flex size-8 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-ink-primary"
                >
                  <ChevronRight className="size-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        )}

        {!mounted ? (
          <Skeleton
            className={cn("w-full rounded-md", filling ? "flex-1" : "h-[420px]")}
          />
        ) : (
          <div
            className={cn(
              "rounded-md border border-hairline bg-bg-surface p-2 transition-opacity duration-150 ease-out sm:p-3",
              loading && "opacity-60",
              filling && "min-h-0 flex-1 overflow-hidden",
            )}
          >
            <FullCalendar
              ref={fcRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={FC_VIEW_BY_KEY[view]}
              locale={ptBrLocale}
              timeZone="America/Sao_Paulo"
              headerToolbar={false}
              height={height}
              firstDay={1}
              // "Agora"/"hoje" na parede de America/Sao_Paulo, seja qual for
              // o fuso do navegador (mesma convenção de isoToFcWall).
              now={() => formatInTz(new Date(), "yyyy-MM-dd'T'HH:mm:ss")}
              nowIndicator
              editable
              longPressDelay={250}
              eventLongPressDelay={250}
              selectLongPressDelay={250}
              dragScroll
              events={events}
              eventContent={renderEventContent}
              datesSet={handleDatesSet}
              eventDrop={handleEventChange}
              eventResize={handleEventChange}
              eventClick={handleEventClick}
            />
          </div>
        )}

        <Dialog
          open={!!pendingMove}
          onOpenChange={(open) => {
            if (!open && pendingMove) {
              pendingMove.revert();
              setPendingMove(null);
            }
          }}
          title="Evento recorrente"
          description="Este evento se repete. O que deseja alterar?"
        >
          <Button
            variant="ghost"
            onClick={() => {
              if (pendingMove) {
                pendingMove.revert();
                setPendingMove(null);
              }
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (pendingMove) {
                const p = pendingMove;
                setPendingMove(null);
                void commitMove(p.occurrence, p.newStart, p.newEnd, "this", p.revert);
              }
            }}
          >
            Somente este
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (pendingMove) {
                const p = pendingMove;
                setPendingMove(null);
                void commitMove(p.occurrence, p.newStart, p.newEnd, "all", p.revert);
              }
            }}
          >
            Todos
          </Button>
        </Dialog>
      </div>
    );
  },
);

CalendarView.displayName = "CalendarView";
