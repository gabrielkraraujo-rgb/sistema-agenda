import { listInvites } from "@/server/actions/invites";
import { SolicitacoesClient } from "./solicitacoes-client";

export default async function SolicitacoesPage() {
  const invites = await listInvites();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="hidden text-2xl font-semibold text-ink-primary md:block">Solicitações</h1>
      <SolicitacoesClient initialInvites={invites} />
    </div>
  );
}
