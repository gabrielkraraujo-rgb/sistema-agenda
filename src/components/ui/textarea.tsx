import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, containerClassName, label, error, id, rows = 3, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label htmlFor={textareaId} className="text-13 font-medium text-ink-primary">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          aria-invalid={!!error}
          className={cn(
            "w-full resize-none rounded-sm border border-border-ring bg-bg-surface px-3 py-2 text-sm text-ink-primary",
            "placeholder:text-ink-muted",
            "transition-shadow duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
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
Textarea.displayName = "Textarea";
