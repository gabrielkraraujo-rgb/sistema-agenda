"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw, Trash2, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { CALENDAR_COLORS } from "@/lib/types";
import type { CalendarDTO, ConnectedAccountDTO } from "@/lib/types";
import { deleteCalendar, updateCalendar } from "@/server/actions/calendars";
import { disconnectAccount, triggerSync } from "@/server/actions/sync";

const providerLabel: Record<CalendarDTO["provider"], string> = {
  LOCAL: "",
  GOOGLE: "Google",
  OUTLOOK: "Outlook",
};

/** Rótulo do provedor a partir do query param (?connected=google etc.). */
const paramProviderLabel: Record<string, string> = {
  google: "Google",
  outlook: "Outlook",
};

interface AgendasClientProps {
  initialCalendars: CalendarDTO[];
  initialAccounts: ConnectedAccountDTO[];
  connectedParam: string | null;
  errorParam: string | null;
}

export function AgendasClient({
  initialCalendars,
  initialAccounts,
  connectedParam,
  errorParam,
}: AgendasClientProps) {
  const [calendars, setCalendars] = useState(initialCalendars);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedAccountDTO | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<string | null>(null);
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);

  // Ajusta o estado local quando o servidor devolve listas novas (após
  // router.refresh()) — feito durante a renderização em vez de em um
  // useEffect, evitando o passo extra de render que um efeito causaria.
  const [prevInitialCalendars, setPrevInitialCalendars] = useState(initialCalendars);
  if (initialCalendars !== prevInitialCalendars) {
    setPrevInitialCalendars(initialCalendars);
    setCalendars(initialCalendars);
  }
  const [prevInitialAccounts, setPrevInitialAccounts] = useState(initialAccounts);
  if (initialAccounts !== prevInitialAccounts) {
    setPrevInitialAccounts(initialAccounts);
    setAccounts(initialAccounts);
  }

  const { toast } = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Toast único para os query params do retorno OAuth (?connected= /
  // ?error=), limpando a URL em seguida para não repetir em refreshes.
  const oauthParamsHandled = useRef(false);
  useEffect(() => {
    if (oauthParamsHandled.current || (!connectedParam && !errorParam)) return;
    oauthParamsHandled.current = true;

    if (connectedParam) {
      const label = paramProviderLabel[connectedParam] ?? connectedParam;
      toast({
        title: "Conta conectada",
        description: `Sua conta ${label} foi conectada e as agendas foram importadas.`,
        variant: "success",
      });
    } else if (errorParam) {
      const label = paramProviderLabel[errorParam] ?? errorParam;
      toast({
        title: "Falha na conexão",
        description: `Não foi possível conectar a conta ${label}. Tente novamente.`,
        variant: "error",
      });
    }
    router.replace("/agendas", { scroll: false });
  }, [connectedParam, errorParam, router, toast]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function handleSyncNow() {
    setSyncing(true);
    const result = await triggerSync();
    setSyncing(false);

    if (result.ok) {
      toast({ title: "Sincronização concluída", variant: "success" });
      refresh();
    } else {
      toast({ title: "Falha ao sincronizar", description: result.error, variant: "error" });
    }
  }

  function openEdit(calendar: CalendarDTO) {
    setEditing(calendar);
    setSheetOpen(true);
  }

  async function handleToggleVisible(calendar: CalendarDTO, checked: boolean) {
    setPendingVisibility(calendar.id);
    setCalendars((current) =>
      current.map((c) => (c.id === calendar.id ? { ...c, isVisible: checked } : c)),
    );

    const result = await updateCalendar({ id: calendar.id, isVisible: checked });

    if (!result.ok) {
      setCalendars((current) =>
        current.map((c) => (c.id === calendar.id ? { ...c, isVisible: calendar.isVisible } : c)),
      );
      toast({ title: "Não foi possível atualizar", description: result.error, variant: "error" });
    } else {
      refresh();
    }
    setPendingVisibility(null);
  }

  async function handleSetDefault(calendar: CalendarDTO) {
    setPendingDefault(calendar.id);
    const previous = calendars;
    setCalendars((current) =>
      current.map((c) => ({ ...c, isDefault: c.id === calendar.id })),
    );

    const result = await updateCalendar({ id: calendar.id, isDefault: true });
    setPendingDefault(null);

    if (!result.ok) {
      setCalendars(previous);
      toast({
        title: "Não foi possível definir como padrão",
        description: result.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Agenda definida como padrão", variant: "success" });
    refresh();
  }

  async function handleDeleteLocal() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteCalendar(deleteTarget.id);
    setDeleting(false);

    if (!result.ok) {
      toast({ title: "Não foi possível excluir", description: result.error, variant: "error" });
      return;
    }

    setCalendars((current) => current.filter((c) => c.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast({ title: "Agenda excluída", variant: "success" });
    refresh();
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    const result = await disconnectAccount(disconnectTarget.id);
    setDisconnecting(false);

    if (!result.ok) {
      toast({ title: "Não foi possível desconectar", description: result.error, variant: "error" });
      return;
    }

    setAccounts((current) => current.filter((a) => a.id !== disconnectTarget.id));
    setCalendars((current) => current.filter((c) => c.accountId !== disconnectTarget.id));
    setDisconnectTarget(null);
    toast({ title: "Conta desconectada", variant: "success" });
    refresh();
  }

  function handleSaved(calendar: CalendarDTO) {
    setCalendars((current) => current.map((c) => (c.id === calendar.id ? { ...c, ...calendar } : c)));
    setSheetOpen(false);
    setEditing(null);
    toast({ title: "Agenda atualizada", variant: "success" });
    refresh();
  }

  const localCalendars = calendars.filter((calendar) => calendar.provider === "LOCAL");

  return (
    <div className="flex flex-col gap-6">
      {accounts.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={handleSyncNow}
            loading={syncing}
            className="gap-1.5"
          >
            <RefreshCw className="size-4" strokeWidth={2} aria-hidden="true" />
            Sincronizar agora
          </Button>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState
          title="Nenhuma conta conectada"
          description="As agendas deste sistema vêm de contas conectadas — conecte o Google ou o Outlook para importar suas agendas e eventos."
          actionSlot={<ConnectButtons />}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {accounts.map((account) => {
            const accountCalendars = calendars.filter((c) => c.accountId === account.id);
            return (
              <Card key={account.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-ink-primary">
                      {account.email}
                    </span>
                    <Badge>{providerLabel[account.provider]}</Badge>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setDisconnectTarget(account)}
                    className="h-8 shrink-0 gap-1.5 px-2.5 text-13"
                  >
                    <Unlink className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    Desconectar
                  </Button>
                </CardHeader>
                <CardContent className="flex flex-col pt-0">
                  {accountCalendars.length === 0 ? (
                    <p className="py-2 text-13 text-ink-muted">
                      Nenhuma agenda importada desta conta ainda.
                    </p>
                  ) : (
                    accountCalendars.map((calendar, index) => (
                      <div
                        key={calendar.id}
                        className={cn(
                          "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between",
                          index > 0 && "border-t border-hairline",
                        )}
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span
                            className="size-3 shrink-0 rounded-full"
                            style={{ backgroundColor: calendar.color }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-sm font-medium text-ink-primary">
                            {calendar.name}
                          </span>
                          {calendar.isReadOnly && <Badge>Somente leitura</Badge>}
                          {calendar.isDefault && <Badge tone="accent">Padrão</Badge>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!calendar.isDefault && (
                            <button
                              type="button"
                              onClick={() => handleSetDefault(calendar)}
                              disabled={pendingDefault === calendar.id}
                              className="whitespace-nowrap rounded-sm px-2 py-1 text-13 font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Definir padrão
                            </button>
                          )}
                          <Switch
                            checked={calendar.isVisible}
                            onCheckedChange={(checked) => handleToggleVisible(calendar, checked)}
                            disabled={pendingVisibility === calendar.id}
                            aria-label={`Visibilidade de ${calendar.name}`}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => openEdit(calendar)}
                            className="h-8 gap-1.5 px-2.5 text-13"
                          >
                            <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
                            Editar
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {localCalendars.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-13 font-medium text-ink-muted">Agendas locais</h2>
          <Card className="flex flex-col p-0">
            {localCalendars.map((calendar, index) => (
              <div
                key={calendar.id}
                className={cn(
                  "flex items-center gap-3 p-3",
                  index > 0 && "border-t border-hairline",
                )}
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: calendar.color }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-ink-primary">
                    {calendar.name}
                  </span>
                  <p className="text-13 text-ink-muted">
                    {calendar.eventCount} {calendar.eventCount === 1 ? "evento" : "eventos"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(calendar)}
                  aria-label={`Editar ${calendar.name}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-ink-primary"
                >
                  <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(calendar)}
                  aria-label={`Excluir ${calendar.name}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 ease-out hover:bg-status-critical/10 hover:text-status-critical"
                >
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <ConnectButtons compact />
        </div>
      )}

      <CalendarEditSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        onSaved={handleSaved}
      />

      <Dialog
        open={!!disconnectTarget}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title="Desconectar conta"
        description={
          disconnectTarget
            ? `Remove a conta ${disconnectTarget.email} e as agendas/eventos dela deste sistema. Nada é apagado no ${providerLabel[disconnectTarget.provider]}.`
            : undefined
        }
      >
        <Button type="button" variant="secondary" onClick={() => setDisconnectTarget(null)}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleDisconnect}
          loading={disconnecting}
        >
          Desconectar
        </Button>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Excluir agenda"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" e ${deleteTarget.eventCount} ${deleteTarget.eventCount === 1 ? "evento" : "eventos"} serão apagados permanentemente. Essa ação não pode ser desfeita.`
            : undefined
        }
      >
        <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
          Cancelar
        </Button>
        <Button type="button" variant="destructive" onClick={handleDeleteLocal} loading={deleting}>
          Excluir
        </Button>
      </Dialog>
    </div>
  );
}

/** Links para /api/oauth/{google|outlook}/start — `compact` reduz o tamanho quando já há contas conectadas. */
function ConnectButtons({ compact = false }: { compact?: boolean }) {
  const sizeClass = compact
    ? "h-9 px-3 text-13"
    : "h-10 px-4 text-sm [@media(pointer:coarse)]:h-11";

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Link
        href="/api/oauth/google/start"
        className={cn(
          "inline-flex flex-1 items-center justify-center rounded-sm border border-hairline bg-bg-surface font-medium text-ink-primary transition-colors duration-150 ease-out hover:bg-bg-subtle",
          sizeClass,
        )}
      >
        Conectar Google
      </Link>
      <Link
        href="/api/oauth/outlook/start"
        className={cn(
          "inline-flex flex-1 items-center justify-center rounded-sm border border-hairline bg-bg-surface font-medium text-ink-primary transition-colors duration-150 ease-out hover:bg-bg-subtle",
          sizeClass,
        )}
      >
        Conectar Outlook
      </Link>
    </div>
  );
}

interface CalendarEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CalendarDTO | null;
  onSaved: (calendar: CalendarDTO) => void;
}

/**
 * Sheet de edição: só nome + cor. É aqui que o usuário define nome e cor de
 * uma agenda recém-conectada (o nome do provedor é só o valor inicial).
 */
function CalendarEditSheet({ open, onOpenChange, editing, onSaved }: CalendarEditSheetProps) {
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? CALENDAR_COLORS[0].hex);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reinicia os campos do form sempre que o sheet transiciona de fechado
  // para aberto — ajustado durante a renderização (não em um useEffect) para
  // evitar o passo extra de render que um efeito causaria.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(editing?.name ?? "");
      setColor(editing?.color ?? CALENDAR_COLORS[0].hex);
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setError(null);

    const result = await updateCalendar({ id: editing.id, name, color });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved({ ...editing, name, color });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Editar agenda">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Pessoal, Trabalho"
          maxLength={60}
          required
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-13 font-medium text-ink-primary">Cor</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        {error && <p className="text-13 text-status-critical">{error}</p>}

        <Button type="submit" loading={submitting} disabled={name.trim().length === 0}>
          Salvar
        </Button>
      </form>
    </Sheet>
  );
}
