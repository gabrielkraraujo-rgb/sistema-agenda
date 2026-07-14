import { listCalendars } from "@/server/actions/calendars";
import { listConnectedAccounts } from "@/server/actions/sync";
import { AgendasClient } from "./agendas-client";

interface AgendasPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function AgendasPage({ searchParams }: AgendasPageProps) {
  const [calendars, accounts, params] = await Promise.all([
    listCalendars(),
    listConnectedAccounts(),
    searchParams,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="hidden text-2xl font-semibold text-ink-primary md:block">Agendas</h1>
      <AgendasClient
        initialCalendars={calendars}
        initialAccounts={accounts}
        connectedParam={asString(params.connected)}
        errorParam={asString(params.error)}
      />
    </div>
  );
}
