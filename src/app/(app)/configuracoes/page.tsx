import { getSettings } from "@/server/actions/settings";
import { ConfiguracoesClient } from "./configuracoes-client";

export default async function ConfiguracoesPage() {
  const settings = await getSettings();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="hidden text-2xl font-semibold text-ink-primary md:block">Ajustes</h1>
      <ConfiguracoesClient initialSettings={settings} />
    </div>
  );
}
