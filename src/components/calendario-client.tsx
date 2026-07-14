"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncButton } from "@/components/sync-button";
import { CalendarView } from "@/components/calendar-view";
import { EventDetailSheet } from "@/components/event-detail-sheet";
import { EventForm } from "@/components/event-form";
import { useEventOrchestration } from "@/hooks/use-event-orchestration";

// Chave própria — não compartilha a última view escolhida com o calendário
// compacto do dashboard (specs/05).
const STORAGE_KEY = "agenda:calendar-view:calendario";

/**
 * Página `/calendario` (specs/05): calendário em tela cheia, sem stat tiles
 * nem "Próximos eventos" — reaproveita `CalendarView`/`EventDetailSheet`/
 * `EventForm` e a mesma orquestração do dashboard (`useEventOrchestration`),
 * apenas com toolbar/persistência de view próprias e altura preenchendo a
 * viewport (o wrapper abaixo desconta o header/bottom-nav fixos no mobile e
 * o padding vertical do `<main>` no desktop — ver `(app)/layout.tsx`).
 */
export function CalendarioClient() {
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
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top)-72px-env(safe-area-inset-bottom)-80px)] flex-col gap-4 md:h-[calc(100dvh-64px)]">
      <div className="hidden shrink-0 items-center justify-between md:flex">
        <h1 className="text-2xl font-semibold text-ink-primary">Calendário</h1>
        <div className="flex items-center gap-2">
          <SyncButton onSynced={handleMutated} />
          <Button onClick={openCreateForm}>
            <Plus className="size-4" strokeWidth={2} />
            Novo evento
          </Button>
        </div>
      </div>

      <CalendarView
        ref={calendarRef}
        onSelectOccurrence={openDetail}
        storageKey={STORAGE_KEY}
        height="100%"
        className="min-h-0 flex-1"
      />

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
