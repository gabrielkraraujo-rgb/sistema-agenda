import type { ReactNode } from "react";
import { AppNav, RouteHeaderTitle } from "@/components/app-nav";

/**
 * Shell autenticado. A proteção de rota é feita pelo middleware (outro
 * agente) — este layout não faz nenhuma checagem de sessão.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full md:pl-60">
      {/* Header fixo mobile: título da rota + espaço para ações */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-hairline bg-bg-surface pt-[env(safe-area-inset-top)] md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <RouteHeaderTitle className="text-base font-semibold text-ink-primary" />
          <div aria-hidden="true" className="size-8" />
        </div>
      </header>

      <AppNav />

      <main
        className={[
          "px-4 pt-[calc(env(safe-area-inset-top)+72px)] pb-[calc(env(safe-area-inset-bottom)+80px)]",
          "md:mx-auto md:max-w-[1040px] md:px-8 md:pb-8 md:pt-8",
        ].join(" ")}
      >
        {children}
      </main>
    </div>
  );
}
