import { requireSession } from "@/lib/auth/session";
import { getDashboardStats } from "@/server/actions/dashboard";
import { getUpcomingEvents } from "@/server/actions/events";
import { scheduleBackgroundRefresh } from "@/server/background-refresh";
import { DashboardClient } from "@/components/dashboard-client";
import type { DashboardStatsDTO, OccurrenceDTO } from "@/lib/types";

const EMPTY_STATS: DashboardStatsDTO = { todayCount: 0, weekCount: 0, pendingInviteCount: 0 };

/**
 * Dashboard (specs/05). As server actions de dados (Onda 2A) podem ainda
 * estar como stub enquanto este componente é desenvolvido em paralelo — por
 * isso as chamadas usam `Promise.allSettled` com fallback vazio/zerado em
 * vez de deixar a página inteira quebrar. Sem UI de erro especial: uma
 * falha aqui apenas resulta em stats zerados / lista vazia (visível via
 * console.warn para depuração).
 */
export default async function DashboardPage() {
  await requireSession();

  scheduleBackgroundRefresh();

  const [statsResult, upcomingResult] = await Promise.allSettled([
    getDashboardStats(),
    getUpcomingEvents(3),
  ]);

  let stats: DashboardStatsDTO = EMPTY_STATS;
  if (statsResult.status === "fulfilled") {
    stats = statsResult.value;
  } else {
    console.warn("[dashboard] getDashboardStats falhou:", statsResult.reason);
  }

  let upcoming: OccurrenceDTO[] = [];
  if (upcomingResult.status === "fulfilled") {
    upcoming = upcomingResult.value;
  } else {
    console.warn("[dashboard] getUpcomingEvents falhou:", upcomingResult.reason);
  }

  return <DashboardClient initialStats={stats} initialUpcoming={upcoming} />;
}
