"use server";

// Actions de sincronização (specs/06): botão "Sincronizar agora" e lista de
// contas conectadas em /agendas.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { syncAllAccounts } from "@/server/integrations/sync";
import type { ActionResult, ConnectedAccountDTO } from "@/lib/types";

/**
 * Sincroniza todas as contas conectadas agora. Falhas por conta são
 * registradas (warn) dentro de syncAllAccounts sem derrubar as demais.
 */
export async function triggerSync(): Promise<ActionResult> {
  await requireSession();

  try {
    await syncAllAccounts();
  } catch (err) {
    console.warn("[sync] triggerSync falhou:", err);
    return { ok: false, error: "Não foi possível sincronizar. Tente novamente." };
  }

  revalidatePath("/");
  revalidatePath("/agendas");

  return { ok: true, data: undefined };
}

const disconnectAccountSchema = z.string().min(1, "Conta inválida");

/**
 * Desconecta uma conta: apaga o ConnectedAccount localmente. O cascade do
 * schema (ConnectedAccount -> Calendar -> Event) remove as agendas e os
 * eventos locais dessa conta junto. Nada é revogado ou apagado no provedor
 * (Google/Outlook) — apenas paramos de sincronizar com ele por aqui.
 */
export async function disconnectAccount(accountId: string): Promise<ActionResult> {
  await requireSession();

  const parsed = disconnectAccountSchema.safeParse(accountId);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Conta inválida" };
  }

  const account = await prisma.connectedAccount.findUnique({ where: { id: parsed.data } });
  if (!account) {
    return { ok: false, error: "Conta não encontrada" };
  }

  await prisma.connectedAccount.delete({ where: { id: parsed.data } });

  revalidatePath("/");
  revalidatePath("/agendas");

  return { ok: true, data: undefined };
}

export async function listConnectedAccounts(): Promise<ConnectedAccountDTO[]> {
  await requireSession();

  const accounts = await prisma.connectedAccount.findMany({
    include: { _count: { select: { calendars: true } } },
    orderBy: { createdAt: "asc" },
  });

  return accounts
    .filter((account) => account.provider !== "LOCAL")
    .map((account) => ({
      id: account.id,
      provider: account.provider as ConnectedAccountDTO["provider"],
      email: account.email,
      calendarCount: account._count.calendars,
    }));
}
