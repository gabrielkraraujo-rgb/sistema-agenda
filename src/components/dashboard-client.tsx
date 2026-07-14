"use client";

import { CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncButton } from "@/components/sync-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/stat-tile";
import { EventCard } from "@/components/event-card";
import { CalendarView } from "@/components/calendar-view";
import { EventDetailSheet } from "@/components/event-detail-sheet";
import { EventForm } from "@/components/event-form";
import { useEventOrchestration } from "@/hooks/use-event-orchestration";
import type { DashboardStatsDTO, OccurrenceDTO } from "@/lib/types";

export interface DashboardClientProps {
  initialStats: DashboardStatsDTO;
  initialUpcoming: OccurrenceDTO[];
}

/**
 * Orquestra o dashboard (specs/05): liga stat tiles ao calendário, gerencia
 * o sheet de detalhe e o form de criar/editar (via `useEventOrchestration`,
 * compartilhado com `/calendario`), e recarrega dados após mutações.
 * `initialStats`/`initialUpcoming` vêm do server component (page.tsx) e são
 * atualizados automaticamente por `router.refresh()`.
 */
export function DashboardClient({ initialStats, initialUpcoming }: DashboardClientProps) {
  const {
    calendarRef,
    selectedOccurrence,
    detailOpen,
    setDetailOpen,
    formOpen,
    setFormOpen,
    formOccurrence,
    formSession,
    openDetail,
    openCreateForm,
    openEditForm,
    handleMutated,
  } = useEventOrchestration();

  return (
    <div className="flex flex-col gap-6 pb-6 md:gap-8">
      <div className="hidden items-center justify-between md:flex">
        <h1 className="text-2xl font-semibold text-ink-primary">Início</h1>
        <div className="flex items-center gap-2">
          <SyncButton onSynced={handleMutated} />
          <Button onClick={openCreateForm}>
            <Plus className="size-4" strokeWidth={2} />
            Novo evento
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile
          label="Eventos hoje"
          value={initialStats.todayCount}
          onClick={() => calendarRef.current?.setView("hoje")}
        />
        <StatTile
          label="Nesta semana"
          value={initialStats.weekCount}
          onClick={() => calendarRef.current?.setView("semana")}
        />
        <StatTile
          label="Solicitações"
          value={initialStats.pendingInviteCount}
          href="/solicitacoes"
          dot={initialStats.pendingInviteCount > 0}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink-primary">Próximos eventos</h2>
        {initialUpcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhum evento agendado"
            description="Seus próximos eventos aparecem aqui."
            action={{ label: "Criar evento", onClick: openCreateForm }}
          />
        ) : (
          <div className="flex flex-col divide-y divide-hairline rounded-md border border-hairline bg-bg-surface">
            {initialUpcoming.map((occurrence) => (
              <EventCard
                key={occurrence.id}
                occurrence={occurrence}
                onClick={() => openDetail(occurrence)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <CalendarView ref={calendarRef} onSelectOccurrence={openDetail} />
      </section>

      <button
        type="button"
        onClick={openCreateForm}
        aria-label="Novo evento"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-ink-primary text-white shadow-[0_4px_12px_rgba(11,11,11,0.18)] transition-transform duration-150 ease-out active:scale-[0.98] md:hidden"
      >
        <Plus className="size-6" strokeWidth={2} />
      </button>

      <EventDetailSheet
        occurrence={selectedOccurrence}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={openEditForm}
        onMutated={handleMutated}
      />

      <EventForm
        key={formSession}
        open={formOpen}
        onOpenChange={setFormOpen}
        occurrence={formOccurrence}
        onSaved={handleMutated}
      />
    </div>
  );
}
