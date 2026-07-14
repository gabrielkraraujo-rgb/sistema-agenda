"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarViewHandle } from "@/components/calendar-view";
import type { OccurrenceDTO } from "@/lib/types";

/**
 * Orquestração compartilhada entre o dashboard (`/`) e a página
 * `/calendario` (specs/05): liga o `CalendarView` ao sheet de detalhe e ao
 * form de criar/editar, e recarrega dados após mutações. Extraído para não
 * duplicar o mesmo conjunto de estados/handlers em `DashboardClient` e
 * `CalendarioClient`.
 */
export function useEventOrchestration() {
  const router = useRouter();
  const calendarRef = useRef<CalendarViewHandle | null>(null);

  const [selectedOccurrence, setSelectedOccurrence] = useState<OccurrenceDTO | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formOccurrence, setFormOccurrence] = useState<OccurrenceDTO | null>(null);
  // Incrementada a cada abertura do form — usada como `key` do EventForm
  // para forçar remontagem (estado dos campos sempre "fresco" ao abrir, sem
  // precisar de um efeito de sincronização dentro do form).
  const [formSession, setFormSession] = useState(0);

  const openDetail = useCallback((occurrence: OccurrenceDTO) => {
    setSelectedOccurrence(occurrence);
    setDetailOpen(true);
  }, []);

  const openCreateForm = useCallback(() => {
    setFormOccurrence(null);
    setFormSession((n) => n + 1);
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((occurrence: OccurrenceDTO) => {
    setDetailOpen(false);
    setFormOccurrence(occurrence);
    setFormSession((n) => n + 1);
    setFormOpen(true);
  }, []);

  const handleMutated = useCallback(() => {
    router.refresh();
    calendarRef.current?.refetch();
  }, [router]);

  return {
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
  };
}
