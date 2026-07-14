import { after } from "next/server";
import { syncAllAccounts } from "@/server/integrations/sync";
import { refreshTravelForUpcoming } from "@/server/integrations/maps";

// Throttles curtos por processo: evitam marteladas em navegações rápidas.
// O custo real já é limitado pelos syncTokens (pull incremental) e pelo
// cache de 10 min das rotas — por isso o sync dispara em TODA recarga.
let lastSyncFiredAt = 0;
let lastTravelFiredAt = 0;
const SYNC_THROTTLE_MS = 15_000;
const TRAVEL_THROTTLE_MS = 60_000;

/**
 * Sync das contas conectadas + rotas em segundo plano, após a resposta ser
 * enviada (`after()`) — specs/06/08. Chamado no load do dashboard e do
 * /calendario para que recarregar a página sempre puxe novidades sem
 * atrasar o render; o botão "Sincronizar" cobre o refresh imediato.
 */
export function scheduleBackgroundRefresh(): void {
  after(async () => {
    const now = Date.now();
    if (now - lastSyncFiredAt >= SYNC_THROTTLE_MS) {
      lastSyncFiredAt = now;
      try {
        await syncAllAccounts();
      } catch (err) {
        console.warn("[refresh] sync em segundo plano falhou:", err);
      }
    }
    if (now - lastTravelFiredAt >= TRAVEL_THROTTLE_MS) {
      lastTravelFiredAt = now;
      try {
        await refreshTravelForUpcoming();
      } catch (err) {
        console.warn("[refresh] rotas em segundo plano falharam:", err);
      }
    }
  });
}
