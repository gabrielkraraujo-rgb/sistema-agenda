"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const noopSubscribe = () => () => {};

/** Evita renderizar o portal no SSR (document indisponível no servidor). */
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Bottom sheet no mobile (<768px) / painel lateral no desktop (>=768px).
 * Fecha por clique no overlay ou no X. Entrada: slide-up (mobile) / slide-in
 * pela direita (desktop), 200ms ease-out — ver keyframes em globals.css.
 */
export function Sheet({ open, onOpenChange, title, children, className }: SheetProps) {
  const mounted = useMounted();

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-[rgba(11,11,11,0.4)] animate-overlay-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-md border-t border-hairline bg-bg-surface animate-sheet-up",
          "md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[420px] md:max-h-none md:rounded-none md:border-l md:border-t-0 md:animate-panel-in",
          className,
        )}
      >
        <div className="flex items-center justify-center pt-2 md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-hairline" />
        </div>
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-base font-semibold text-ink-primary">{title}</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-ink-primary"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
