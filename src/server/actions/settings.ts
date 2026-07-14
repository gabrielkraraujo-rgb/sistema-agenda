"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { sendWhatsapp } from "@/server/integrations/evolution";
import type {
  ActionResult,
  SettingsDTO,
  SettingsUpdateInput,
} from "@/lib/types";

/** Linha única (id = 1) — helper interno reaproveitado por outras ondas (cron/sync). */
export async function getSettingsRow() {
  return prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function getSettings(): Promise<SettingsDTO> {
  await requireSession();
  const row = await getSettingsRow();

  return {
    evolutionBaseUrl: row.evolutionBaseUrl,
    evolutionInstance: row.evolutionInstance,
    evolutionApiKeySet: !!row.evolutionApiKey,
    whatsappTargetNumber: row.whatsappTargetNumber,
    googleMapsApiKeySet: !!row.googleMapsApiKey,
    notifyDailySummary: row.notifyDailySummary,
    dailySummaryTime: row.dailySummaryTime,
    notifyEventReminder: row.notifyEventReminder,
    defaultReminderMinutes: row.defaultReminderMinutes,
    notifyNewInvite: row.notifyNewInvite,
    notifyLateAlert: row.notifyLateAlert,
  };
}

const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:mm)");

const settingsUpdateSchema = z.object({
  evolutionBaseUrl: z.string().trim().max(300).nullable().optional(),
  evolutionInstance: z.string().trim().max(120).nullable().optional(),
  evolutionApiKey: z.string().max(500).nullable().optional(),
  whatsappTargetNumber: z.string().trim().max(30).nullable().optional(),
  googleMapsApiKey: z.string().max(500).nullable().optional(),
  notifyDailySummary: z.boolean().optional(),
  dailySummaryTime: hhmmSchema.optional(),
  notifyEventReminder: z.boolean().optional(),
  defaultReminderMinutes: z.number().int().min(0).max(1440).optional(),
  notifyNewInvite: z.boolean().optional(),
  notifyLateAlert: z.boolean().optional(),
});

export async function updateSettings(patch: SettingsUpdateInput): Promise<ActionResult> {
  await requireSession();

  const parsed = settingsUpdateSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const data = parsed.data;

  // Campos escalares simples (nunca operadores tipo `{ increment }`) — essa
  // forma "achatada" é estruturalmente compatível tanto com
  // `Prisma.SettingsUpdateInput` quanto com `Prisma.SettingsCreateInput`,
  // então dá para usar o mesmo objeto nos dois braços do upsert abaixo.
  interface SettingsWritableFields {
    evolutionBaseUrl?: string | null;
    evolutionInstance?: string | null;
    evolutionApiKey?: string | null;
    whatsappTargetNumber?: string | null;
    googleMapsApiKey?: string | null;
    notifyDailySummary?: boolean;
    dailySummaryTime?: string;
    notifyEventReminder?: boolean;
    defaultReminderMinutes?: number;
    notifyNewInvite?: boolean;
    notifyLateAlert?: boolean;
  }

  const update: SettingsWritableFields = {};

  // Chaves de API (specs/04, types.ts): string não-vazia grava
  // criptografada; "" mantém a atual (o campo password nunca mostra o
  // valor salvo, então "em branco" = "não mexeu"); null explícito limpa.
  function applySecret(key: "evolutionApiKey" | "googleMapsApiKey") {
    const value = data[key];
    if (value === undefined) return;
    if (value === null) {
      update[key] = null;
      return;
    }
    if (value === "") return;
    update[key] = encryptSecret(value);
  }
  applySecret("evolutionApiKey");
  applySecret("googleMapsApiKey");

  // Campos de texto simples (não são segredos, o form mostra o valor
  // atual): "" e null são tratados como "limpar".
  if (data.evolutionBaseUrl !== undefined) update.evolutionBaseUrl = data.evolutionBaseUrl || null;
  if (data.evolutionInstance !== undefined) update.evolutionInstance = data.evolutionInstance || null;
  if (data.whatsappTargetNumber !== undefined) {
    update.whatsappTargetNumber = data.whatsappTargetNumber || null;
  }

  if (data.notifyDailySummary !== undefined) update.notifyDailySummary = data.notifyDailySummary;
  if (data.dailySummaryTime !== undefined) update.dailySummaryTime = data.dailySummaryTime;
  if (data.notifyEventReminder !== undefined) update.notifyEventReminder = data.notifyEventReminder;
  if (data.defaultReminderMinutes !== undefined) {
    update.defaultReminderMinutes = data.defaultReminderMinutes;
  }
  if (data.notifyNewInvite !== undefined) update.notifyNewInvite = data.notifyNewInvite;
  if (data.notifyLateAlert !== undefined) update.notifyLateAlert = data.notifyLateAlert;

  await prisma.settings.upsert({
    where: { id: 1 },
    update,
    create: { id: 1, ...update },
  });

  revalidatePath("/configuracoes");

  return { ok: true, data: undefined };
}

export async function testWhatsapp(): Promise<ActionResult<{ sent: true }>> {
  await requireSession();

  const row = await getSettingsRow();
  if (!row.evolutionBaseUrl || !row.evolutionInstance || !row.evolutionApiKey) {
    return {
      ok: false,
      error: "Configure URL base, instância e chave da Evolution API antes de testar.",
    };
  }

  const sent = await sendWhatsapp(
    "Mensagem de teste do sistema Agenda. Configuração funcionando.",
  );
  return sent
    ? { ok: true, data: { sent: true } }
    : { ok: false, error: "Falha ao enviar. Confira as configurações." };
}
