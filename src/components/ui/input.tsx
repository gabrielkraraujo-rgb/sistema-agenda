import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, containerClassName, label, error, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-13 font-medium text-ink-primary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          className={cn(
            "h-10 w-full rounded-sm border border-border-ring bg-bg-surface px-3 text-sm text-ink-primary",
            "placeholder:text-ink-muted",
            "transition-shadow duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "[@media(pointer:coarse)]:h-11",
            error && "border-status-critical focus-visible:ring-status-critical",
            className,
          )}
          {...props}
        />
        {error && <p className="text-13 text-status-critical">{error}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";
