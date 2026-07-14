import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-primary text-white border border-ink-primary hover:opacity-90",
  secondary:
    "bg-bg-surface text-ink-primary border border-hairline hover:bg-bg-subtle",
  ghost:
    "bg-transparent text-ink-primary border border-transparent hover:bg-bg-subtle",
  destructive:
    "bg-transparent text-status-critical border border-status-critical/30 hover:bg-status-critical/10",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Mostra spinner e desabilita o botão. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", loading = false, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium",
          "transition-transform duration-150 ease-out active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          "[@media(pointer:coarse)]:h-11",
          variantClasses[variant],
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
