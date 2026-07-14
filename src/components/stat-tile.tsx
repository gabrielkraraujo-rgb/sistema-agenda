"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export interface StatTileProps {
  label: string;
  value: number;
  /** Navega para uma rota (ex.: Solicitações) — tem prioridade sobre `onClick`. */
  href?: string;
  onClick?: () => void;
  /** Dot `--accent` ao lado do label — usado em Solicitações quando > 0. */
  dot?: boolean;
  className?: string;
}

/**
 * Contrato specs/01: label 13 muted (sentence case, sem dois-pontos) + valor
 * 30 semibold (24 no mobile). Card clicável — muda a view do calendário
 * (Hoje/Semana) ou navega para /solicitacoes.
 */
export function StatTile({ label, value, href, onClick, dot = false, className }: StatTileProps) {
  const sharedClassName = cn(
    "flex flex-col items-start gap-1 rounded-md border border-hairline bg-bg-surface p-3 text-left",
    "transition-transform duration-150 ease-out active:scale-[0.98] hover:bg-bg-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
    className,
  );

  const content = (
    <>
      <span className="flex items-center gap-1.5 text-13 font-medium text-ink-muted">
        {label}
        {dot && <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </span>
      <span className="text-2xl font-semibold text-ink-primary sm:text-3xl">{value}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={sharedClassName}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={sharedClassName}>
      {content}
    </button>
  );
}
