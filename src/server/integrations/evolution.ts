// WhatsApp via Evolution API — specs/09 (Onda 3D).
// Contrato: configuração incompleta => retorna false / no-op, sem lançar.
// Assinaturas CONGELADAS: sendWhatsapp, notifyNewInvite, sendLateAlert —
// actions (settings.ts), sync (3A/3B) e scheduler chamam isto.

import { Prisma } from "@prisma/client";
import type { NotificationType, Settings } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getSettingsRow } from "@/server/actions/settings";
import { formatInTz, formatTime } from "@/lib/datetime";

const FETCH_TIMEOUT_MS = 10_000;

type EvolutionConfigFields = Pick<
  Settings,
  "evolutionBaseUrl" | "evolutionInstance" | "evolutionApiKey"
>;

/** true se URL base, instância e chave estão preenchidas. */
export function hasEvolutionConfig(settings: EvolutionConfigFields): boolean {
  return Boolean(
    settings.evolutionBaseUrl &&
      settings.evolutionInstance &&
      settings.evolutionApiKey,
  );
}

/**
 * Normaliza para dígitos com DDI: "+55 (11) 99999-8888" → "5511999998888".
 * 10–11 dígitos = número brasileiro sem DDI (DDD + fixo/celular) → prefixa
 * 55; um número COM DDI 55 teria 12–13 dígitos, então não há ambiguidade
 * (cobre inclusive DDD 55, ex.: Santa Maria/RS). Menos de 10 dígitos é
 * inválido → null.
 */
export function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

/**
 * Registra o envio no NotificationLog ANTES de enviar (create com dedupeKey
 * unique) — padrão à prova de corrida: quem perde a corrida recebe P2002 e
 * desiste. Retorna true se este chamador "ganhou" o direito de enviar.
 */
export async function claimNotification(
  type: NotificationType,
  dedupeKey: string,
  eventId?: string,
): Promise<boolean> {
  try {
    await prisma.notificationLog.create({
      data: { type, dedupeKey, eventId: eventId ?? null },
    });
    return true;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return false; // já enviado (ou outro worker ganhou a corrida)
    }
    throw err;
  }
}

/** Libera a chave de dedupe quando o envio falhou (permite nova tentativa). */
export async function releaseNotification(dedupeKey: string): Promise<void> {
  try {
    await prisma.notificationLog.deleteMany({ where: { dedupeKey } });
  } catch {
    // best-effort: no pior caso a notificação fica marcada como enviada
  }
}

/** Envia texto para o número configurado. false se não configurado/falha. */
export async function sendWhatsapp(text: string): Promise<boolean> {
  try {
    const settings = await getSettingsRow();
    if (!hasEvolutionConfig(settings)) return false;

    let target = settings.whatsappTargetNumber;
    if (!target) {
      const user = await prisma.user.findFirst({ select: { phone: true } });
      target = user?.phone ?? null;
    }
    if (!target) return false;

    const number = normalizeWhatsappNumber(target);
    if (!number) return false;

    // A chave nunca aparece em logs; decodificação falha => não configurado.
    let apiKey: string;
    try {
      apiKey = decryptSecret(settings.evolutionApiKey as string);
    } catch {
      console.warn("[evolution] chave da Evolution API inválida/corrompida.");
      return false;
    }

    const baseUrl = (settings.evolutionBaseUrl as string).replace(/\/+$/, "");
    const url = `${baseUrl}/message/sendText/${encodeURIComponent(settings.evolutionInstance as string)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number, text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[evolution] envio falhou: HTTP ${res.status}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(
      "[evolution] falha ao enviar mensagem:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** Notifica convite novo (chamado pelo sync ao importar NEEDS_ACTION novo). */
export async function notifyNewInvite(eventId: string): Promise<void> {
  try {
    const settings = await getSettingsRow();
    if (!settings.notifyNewInvite || !hasEvolutionConfig(settings)) return;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return;

    const dedupeKey = `invite:${eventId}`;
    if (!(await claimNotification("NEW_INVITE", dedupeKey, eventId))) return;

    const when = `${formatInTz(event.startAt, "dd/MM")} às ${formatTime(event.startAt)}`;
    const organizer = event.organizerEmail ? `, de ${event.organizerEmail}` : "";
    const sent = await sendWhatsapp(
      `Novo convite: ${event.title}, ${when}${organizer}. Responda no app.`,
    );
    if (!sent) await releaseNotification(dedupeKey);
  } catch (err) {
    console.error("[evolution] notifyNewInvite falhou:", err);
  }
}

/** Alerta de atraso (chamado pelo ciclo de Maps do scheduler). */
export async function sendLateAlert(
  eventId: string,
  occurrenceStartIso: string,
  lateByMin: number,
): Promise<void> {
  try {
    const settings = await getSettingsRow();
    if (!settings.notifyLateAlert || !hasEvolutionConfig(settings)) return;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return;

    const dedupeKey = `late:${eventId}:${occurrenceStartIso}`;
    if (!(await claimNotification("LATE_ALERT", dedupeKey, eventId))) return;

    const sent = await sendWhatsapp(
      `Atenção: pelo trânsito atual você chega cerca de ${lateByMin} min atrasado em ${event.title} (${formatTime(occurrenceStartIso)}).`,
    );
    if (!sent) await releaseNotification(dedupeKey);
  } catch (err) {
    console.error("[evolution] sendLateAlert falhou:", err);
  }
}
