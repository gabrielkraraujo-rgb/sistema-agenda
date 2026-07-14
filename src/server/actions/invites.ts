"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { collectOccurrences } from "@/server/occurrences";
import { respondInviteExternal } from "@/server/integrations/push";
import type { ActionResult, OccurrenceDTO } from "@/lib/types";

const UPCOMING_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

export async function listInvites(): Promise<OccurrenceDTO[]> {
  await requireSession();

  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_HORIZON_MS);

  const occurrences = await collectOccurrences(now, windowEnd);

  return occurrences
    .filter((o) => o.inviteStatus === "NEEDS_ACTION")
    .sort((a, b) => a.start.localeCompare(b.start));
}

const respondInviteSchema = z.object({
  eventId: z.string().min(1),
  response: z.enum(["ACCEPTED", "DECLINED"]),
});

export async function respondInvite(input: {
  eventId: string;
  response: "ACCEPTED" | "DECLINED";
}): Promise<ActionResult> {
  await requireSession();

  const parsed = respondInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const event = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    include: { calendar: true },
  });
  if (!event) return { ok: false, error: "Convite não encontrado" };

  const previousStatus = event.inviteStatus;

  await prisma.event.update({
    where: { id: event.id },
    data: { inviteStatus: parsed.data.response },
  });

  if (event.calendar.provider !== "LOCAL") {
    try {
      await respondInviteExternal(event.id, parsed.data.response);
    } catch (err) {
      // Reverte a mudança local — specs/04: "se falhar o push, reverter e
      // retornar erro".
      await prisma.event.update({
        where: { id: event.id },
        data: { inviteStatus: previousStatus },
      });
      console.warn("[invites] respondInviteExternal falhou:", err);
      revalidatePath("/solicitacoes");
      return {
        ok: false,
        error: "Não foi possível sincronizar sua resposta com o provedor. Tente novamente.",
      };
    }
  }

  revalidatePath("/solicitacoes");
  revalidatePath("/");

  return { ok: true, data: undefined };
}
