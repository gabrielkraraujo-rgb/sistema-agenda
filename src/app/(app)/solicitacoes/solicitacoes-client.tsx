"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";
import { EventCard } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { respondInvite } from "@/server/actions/invites";
import type { OccurrenceDTO } from "@/lib/types";

interface SolicitacoesClientProps {
  initialInvites: OccurrenceDTO[];
}

export function SolicitacoesClient({ initialInvites }: SolicitacoesClientProps) {
  const [invites, setInvites] = useState(initialInvites);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleRespond(invite: OccurrenceDTO, response: "ACCEPTED" | "DECLINED") {
    setPendingId(invite.id);
    const result = await respondInvite({ eventId: invite.eventId, response });
    setPendingId(null);

    if (!result.ok) {
      toast({ title: "Não foi possível responder", description: result.error, variant: "error" });
      return;
    }

    setInvites((current) => current.filter((i) => i.id !== invite.id));
    toast({
      title: response === "ACCEPTED" ? "Convite aceito" : "Convite recusado",
      variant: "success",
    });
  }

  if (invites.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nenhuma solicitação pendente"
        description="Convites recebidos por sincronização com Google/Outlook aparecem aqui."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {invites.map((invite) => (
        <div key={invite.id} className="overflow-hidden rounded-md border border-hairline bg-bg-surface">
          <EventCard occurrence={invite} />
          <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2.5">
            <span className="min-w-0 truncate text-13 text-ink-muted">
              {invite.organizerEmail ? `De ${invite.organizerEmail}` : "Organizador desconhecido"}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleRespond(invite, "DECLINED")}
                loading={pendingId === invite.id}
              >
                Recusar
              </Button>
              <Button
                type="button"
                onClick={() => handleRespond(invite, "ACCEPTED")}
                loading={pendingId === invite.id}
              >
                Aceitar
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
