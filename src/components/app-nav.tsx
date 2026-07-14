"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, CalendarDays, CalendarRange, Settings, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * 5 itens fixos da navegação principal (specs/01/05). "Agendas" usa o ícone
 * calendar-range (a alternativa layers foi descartada por ser menos
 * associada a "calendário/agenda" nesse contexto); "Calendário" (página
 * `/calendario` em tela cheia) usa o ícone calendar, entre "Início" e
 * "Agendas".
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Início", icon: CalendarDays },
  { href: "/calendario", label: "Calendário", icon: Calendar },
  { href: "/agendas", label: "Agendas", icon: CalendarRange },
  { href: "/perfil", label: "Perfil", icon: User },
  { href: "/configuracoes", label: "Ajustes", icon: Settings },
];

/** Rotas fora da bottom nav que ainda precisam de título no header. */
const EXTRA_TITLES: Record<string, string> = {
  "/solicitacoes": "Solicitações",
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getRouteTitle(pathname: string): string {
  const navMatch = NAV_ITEMS.find((item) => isActive(pathname, item.href));
  if (navMatch) return navMatch.label;

  const extraMatch = Object.entries(EXTRA_TITLES).find(([href]) =>
    isActive(pathname, href),
  );
  return extraMatch?.[1] ?? "Agenda";
}

/** Título da rota atual — usado no header fixo mobile. */
export function RouteHeaderTitle({ className }: { className?: string }) {
  const pathname = usePathname();
  return <span className={className}>{getRouteTitle(pathname)}</span>;
}

/** Bottom nav (mobile, <768px) + sidebar (desktop, >=768px). */
export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: bottom nav fixa */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="flex h-16 items-stretch">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-accent" : "text-ink-muted",
                )}
              >
                <Icon className="size-6" strokeWidth={2} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop: sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-hairline bg-bg-surface md:flex">
        <div className="flex h-16 items-center px-5">
          <span className="text-lg font-semibold text-ink-primary">Agenda</span>
        </div>
        <nav aria-label="Navegação principal" className="flex flex-col gap-0.5 px-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out",
                  active
                    ? "bg-accent-subtle text-accent"
                    : "text-ink-secondary hover:bg-bg-subtle hover:text-ink-primary",
                )}
              >
                <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
