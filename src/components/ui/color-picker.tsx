import { Check } from "lucide-react";
import { CALENDAR_COLORS } from "@/lib/types";
import { cn } from "@/lib/cn";

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}

/** 8 swatches na ordem fixa de CALENDAR_COLORS (specs/01) — não reordenar. */
export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)} role="radiogroup" aria-label="Cor da agenda">
      {CALENDAR_COLORS.map((color) => {
        const selected = value.toLowerCase() === color.hex.toLowerCase();
        return (
          <button
            key={color.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.name}
            onClick={() => onChange(color.hex)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-transform duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
              selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg-page",
            )}
            style={{ backgroundColor: color.hex }}
          >
            {selected && <Check className="size-4 text-white" strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}
