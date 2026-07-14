"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { CALENDAR_COLORS } from "@/lib/types";
import type { ActionResult, CalendarDTO } from "@/lib/types";

function isValidColor(hex: string): boolean {
  return CALENDAR_COLORS.some((option) => option.hex.toLowerCase() === hex.toLowerCase());
}

export async function listCalendars(): Promise<CalendarDTO[]> {
  await requireSession();

  const calendars = await prisma.calendar.findMany({
    include: { account: true, _count: { select: { events: true } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return calendars.map((cal) => ({
    id: cal.id,
    name: cal.name,
    color: cal.color,
    provider: cal.provider,
    accountEmail: cal.account?.email ?? null,
    accountId: cal.accountId,
    isVisible: cal.isVisible,
    isDefault: cal.isDefault,
    isReadOnly: cal.isReadOnly,
    eventCount: cal._count.events,
  }));
}

const createCalendarSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(60, "Nome muito longo"),
  color: z.string().min(1, "Escolha uma cor"),
});

export async function createCalendar(input: {
  name: string;
  color: string;
}): Promise<ActionResult<CalendarDTO>> {
  await requireSession();

  const parsed = createCalendarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  if (!isValidColor(parsed.data.color)) {
    return { ok: false, error: "Cor inválida" };
  }

  const existingCount = await prisma.calendar.count();

  const calendar = await prisma.calendar.create({
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      provider: "LOCAL",
      isDefault: existingCount === 0,
    },
  });

  revalidatePath("/agendas");
  revalidatePath("/");

  return {
    ok: true,
    data: {
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      provider: calendar.provider,
      accountEmail: null,
      accountId: null,
      isVisible: calendar.isVisible,
      isDefault: calendar.isDefault,
      isReadOnly: calendar.isReadOnly,
      eventCount: 0,
    },
  };
}

const updateCalendarSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Informe um nome").max(60, "Nome muito longo").optional(),
  color: z.string().min(1).optional(),
  isVisible: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function updateCalendar(input: {
  id: string;
  name?: string;
  color?: string;
  isVisible?: boolean;
  isDefault?: boolean;
}): Promise<ActionResult> {
  await requireSession();

  const parsed = updateCalendarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const { id, name, color, isVisible, isDefault } = parsed.data;

  if (color !== undefined && !isValidColor(color)) {
    return { ok: false, error: "Cor inválida" };
  }

  const calendar = await prisma.calendar.findUnique({ where: { id } });
  if (!calendar) {
    return { ok: false, error: "Agenda não encontrada" };
  }

  await prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.calendar.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    await tx.calendar.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(isVisible !== undefined ? { isVisible } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
    });
  });

  revalidatePath("/agendas");
  revalidatePath("/");

  return { ok: true, data: undefined };
}

const deleteCalendarSchema = z.string().min(1);

export async function deleteCalendar(id: string): Promise<ActionResult> {
  await requireSession();

  const parsed = deleteCalendarSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Agenda inválida" };
  }

  const calendar = await prisma.calendar.findUnique({ where: { id: parsed.data } });
  if (!calendar) {
    return { ok: false, error: "Agenda não encontrada" };
  }

  if (calendar.isVisible) {
    const visibleCount = await prisma.calendar.count({ where: { isVisible: true } });
    if (visibleCount <= 1) {
      return { ok: false, error: "Não é possível excluir a última agenda visível" };
    }
  }

  // LOCAL: apaga a agenda com seus eventos (cascade no schema). GOOGLE/
  // OUTLOOK: mesma operação localmente — apenas "desconecta" no sentido de
  // que nada é enviado ao provedor (a conta em si não é revogada aqui).
  await prisma.calendar.delete({ where: { id: parsed.data } });

  revalidatePath("/agendas");
  revalidatePath("/");

  return { ok: true, data: undefined };
}
