"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Área de ações (botões) — renderizada abaixo da descrição. */
  children?: ReactNode;
  className?: string;
}

/** Dialog de confirmação — fade + scale, 150ms ease-out. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[rgba(11,11,11,0.4)] animate-overlay-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={cn(
          "relative w-full max-w-sm rounded-md border border-hairline bg-bg-surface p-5 animate-dialog-in",
          className,
        )}
      >
        <h2 id="dialog-title" className="text-base font-semibold text-ink-primary">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-sm text-ink-secondary">{description}</p>
        )}
        {children && (
          <div className="mt-4 flex items-center justify-end gap-2">{children}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
