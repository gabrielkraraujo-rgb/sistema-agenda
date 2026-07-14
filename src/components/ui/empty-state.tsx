import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  /** Slot livre para ações customizadas (ex.: um <Link>). Ignorado se `action` for informado. */
  actionSlot?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  actionSlot,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-dashed border-hairline px-6 py-12 text-center",
        className,
      )}
    >
      <Icon className="size-8 text-ink-muted" strokeWidth={2} aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink-primary">{title}</p>
        {description && <p className="text-13 text-ink-muted">{description}</p>}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 inline-flex h-9 items-center justify-center rounded-sm border border-hairline bg-bg-surface px-3 text-13 font-medium text-ink-primary transition-colors hover:bg-bg-subtle"
        >
          {action.label}
        </button>
      ) : (
        actionSlot
      )}
    </div>
  );
}
