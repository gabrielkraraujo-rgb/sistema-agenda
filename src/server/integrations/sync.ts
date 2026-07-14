// Dispatcher de sincronização — varre contas conectadas e delega ao
// provedor. Chamado pelo cron (specs/09), pelo botão "Sincronizar agora"
// e best-effort no load do dashboard.

import { prisma } from "@/lib/db";
import { syncGoogleAccount } from "./google";
import { syncOutlookAccount } from "./outlook";

export async function syncAllAccounts(): Promise<void> {
  const accounts = await prisma.connectedAccount.findMany({
    select: { id: true, provider: true, email: true },
  });

  for (const account of accounts) {
    try {
      if (account.provider === "GOOGLE") await syncGoogleAccount(account.id);
      else if (account.provider === "OUTLOOK") await syncOutlookAccount(account.id);
    } catch (err) {
      console.warn(`[sync] falha na conta ${account.provider} ${account.email}:`, err);
    }
  }
}
