"use server";

import { requireSession } from "@/lib/auth/session";
import { dayBoundsUtc, weekBoundsUtc } from "@/lib/datetime";
import { collectOccurrences } from "@/server/occurrences";
import type { DashboardStatsDTO } from "@/lib/types";

export async function getDashboardStats(): Promise<DashboardStatsDTO> {
  await requireSession();

  const today = dayBoundsUtc();
  const week = weekBoundsUtc();
  const now = new Date();
  // Horizonte generoso para captar solicitações futuras sem precisar
  // adivinhar quão longe elas estão (mesma abordagem de getUpcomingEvents).
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const [todayOccurrences, weekOccurrences, upcomingOccurrences] = await Promise.all([
    collectOccurrences(today.start, today.end),
    collectOccurrences(week.start, week.end),
    collectOccurrences(now, farFuture),
  ]);

  const pendingInviteCount = upcomingOccurrences.filter(
    (o) => o.inviteStatus === "NEEDS_ACTION",
  ).length;

  return {
    todayCount: todayOccurrences.length,
    weekCount: weekOccurrences.length,
    pendingInviteCount,
  };
}
