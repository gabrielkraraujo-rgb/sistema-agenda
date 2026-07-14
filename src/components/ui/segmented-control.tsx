import { cn } from "@/lib/cn";

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

/** Usado para Hoje / Semana / Mês no calendário (specs/05). */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-bg-subtle p-1",
        className,
      )}
      {...aria}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-13 font-medium transition-colors duration-150 ease-out",
              active
                ? "bg-bg-surface text-ink-primary shadow-[0_1px_2px_rgba(11,11,11,0.05)]"
                : "text-ink-secondary hover:text-ink-primary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
