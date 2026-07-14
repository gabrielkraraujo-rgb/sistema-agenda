// Dispatcher de push para provedores externos — specs/04/06/07.
// LOCAL: no-op. GOOGLE/OUTLOOK: delega ao módulo do provedor.
//
// Contrato com quem chama (events.ts/invites.ts):
// - kind "create"/"update": a linha do evento existe no banco. Pode ser um
//   mestre, um avulso ou uma exceção (recurringEventId != null) — no caso
//   da exceção, o provedor traduz para a instância remota correspondente
//   (originalStartAt), inclusive cancelamento (status CANCELLED).
// - kind "delete": chamado ANTES de apagar a linha localmente, para que o
//   snapshot (externalId etc.) ainda esteja disponível.

import { prisma } from "@/lib/db";
import { googlePushEventChange, googleRespondInvite } from "./google";
import { outlookPushEventChange, outlookRespondInvite } from "./outlook";

async function loadEventWithProvider(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: { include: { account: true } } },
  });
}

export async function pushEventChange(
  eventId: string,
  kind: "create" | "update" | "delete",
): Promise<void> {
  const event = await loadEventWithProvider(eventId);
  if (!event) return;
  const provider = event.calendar.provider;
  if (provider === "LOCAL") return;
  if (provider === "GOOGLE") await googlePushEventChange(event, kind);
  else if (provider === "OUTLOOK") await outlookPushEventChange(event, kind);
}

export async function respondInviteExternal(
  eventId: string,
  response: "ACCEPTED" | "DECLINED",
): Promise<void> {
  const event = await loadEventWithProvider(eventId);
  if (!event) return;
  const provider = event.calendar.provider;
  if (provider === "LOCAL") return;
  if (provider === "GOOGLE") await googleRespondInvite(event, response);
  else if (provider === "OUTLOOK") await outlookRespondInvite(event, response);
}
