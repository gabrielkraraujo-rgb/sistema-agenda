import { requireSession } from "@/lib/auth/session";
import { scheduleBackgroundRefresh } from "@/server/background-refresh";
import { CalendarioClient } from "@/components/calendario-client";

/**
 * Página `/calendario` (specs/05): calendário em tela cheia — sem stats nem
 * "Próximos eventos". Os dados de ocorrências são buscados pelo próprio
 * `CalendarView` no cliente (janela visível via `getOccurrences`), então
 * este server component só garante a sessão.
 */
export default async function CalendarioPage() {
  await requireSession();

  scheduleBackgroundRefresh();

  return <CalendarioClient />;
}
