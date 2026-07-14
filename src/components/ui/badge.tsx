import type { HTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "accent" | "good" | "warning" | "critical";

const toneVar: Record<Exclude<BadgeTone, "neutral">, string> = {
  accent: "var(--accent)",
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Tom predefinido (status) — ignorado se `color` for informado. */
  tone?: BadgeTone;
  /** Cor customizada (ex.: cor da agenda) — sobrepõe `tone`. */
  color?: string;
  /** Ícone opcional; status nunca deve depender só da cor. */
  icon?: LucideIcon;
}

export function Badge({
  className,
  tone = "neutral",
  color,
  icon: Icon,
  style,
  children,
  ...props
}: BadgeProps) {
  const resolvedColor = color ?? (tone !== "neutral" ? toneVar[tone] : undefined);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-ink-primary",
        !resolvedColor && "bg-bg-subtle",
        className,
      )}
      style={
        resolvedColor
          ? {
              backgroundColor: `color-mix(in srgb, ${resolvedColor} 12%, white)`,
              ...style,
            }
          : style
      }
      {...props}
    >
      {Icon && <Icon className="size-3" strokeWidth={2} aria-hidden="true" />}
      {children}
    </span>
  );
}
