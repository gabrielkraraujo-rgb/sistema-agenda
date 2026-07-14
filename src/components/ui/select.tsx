import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
}

/** Select nativo estilizado (sem dependência extra de dropdown custom). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, label, error, id, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label htmlFor={selectId} className="text-13 font-medium text-ink-primary">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={!!error}
            className={cn(
              "h-10 w-full appearance-none rounded-sm border border-border-ring bg-bg-surface pl-3 pr-9 text-sm text-ink-primary",
              "transition-shadow duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "[@media(pointer:coarse)]:h-11",
              error && "border-status-critical focus-visible:ring-status-critical",
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            strokeWidth={2}
          />
        </div>
        {error && <p className="text-13 text-status-critical">{error}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";
