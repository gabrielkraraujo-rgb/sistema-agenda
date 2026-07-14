"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { triggerSync } from "@/server/actions/sync";
import { cn } from "@/lib/cn";

/**
 * Botão de sincronização manual (só ícone, contorno) — fica à esquerda de
 * "Novo evento". Dispara o pull das contas conectadas e atualiza a tela.
 */
export function SyncButton({
  onSynced,
  className,
}: {
  onSynced?: () => void;
  className?: string;
}) {
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  async function handleClick() {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await triggerSync();
      if (result.ok) {
        onSynced?.();
      } else {
        toast({ title: result.error, variant: "error" });
      }
    } catch {
      toast({ title: "Não foi possível sincronizar. Tente novamente.", variant: "error" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      variant="secondary"
      onClick={handleClick}
      disabled={syncing}
      aria-label="Sincronizar agora"
      title="Sincronizar agora"
      className={cn("w-10 shrink-0 px-0", className)}
    >
      <RefreshCw className={cn("size-4", syncing && "animate-spin")} strokeWidth={2} />
    </Button>
  );
}
