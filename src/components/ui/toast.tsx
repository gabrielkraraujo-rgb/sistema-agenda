"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleX, Info, X, type LucideIcon } from "lucide-react";
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

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Duração em ms — padrão 3000 (3s), conforme specs/01. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantIcon: Record<ToastVariant, LucideIcon> = {
  default: Info,
  success: CircleCheck,
  error: CircleX,
};

const variantIconClass: Record<ToastVariant, string> = {
  default: "text-ink-muted",
  success: "text-status-good",
  error: "text-status-critical",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const mounted = useMounted();
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++idRef.current;
      const duration = options.duration ?? 3000;
      setToasts((current) => [...current, { ...options, id }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none fixed inset-x-4 z-[60] flex flex-col items-center gap-2",
              "bottom-[calc(env(safe-area-inset-bottom)+76px)]",
              "md:inset-x-auto md:right-4 md:bottom-4 md:items-end",
            )}
          >
            {toasts.map((item) => {
              const Icon = variantIcon[item.variant ?? "default"];
              return (
                <div
                  key={item.id}
                  role="status"
                  className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border border-hairline bg-bg-surface p-3 shadow-[0_1px_2px_rgba(11,11,11,0.05)] animate-fade-in md:w-auto"
                >
                  <Icon
                    className={cn("mt-0.5 size-4 shrink-0", variantIconClass[item.variant ?? "default"])}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-ink-primary">{item.title}</p>
                    {item.description && (
                      <p className="text-13 text-ink-muted">{item.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(item.id)}
                    aria-label="Fechar"
                    className="text-ink-muted transition-colors duration-150 ease-out hover:text-ink-primary"
                  >
                    <X className="size-4" strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de <ToastProvider>.");
  }
  return context;
}
