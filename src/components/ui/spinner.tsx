import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SpinnerProps {
  className?: string;
  /** Tamanho em px do ícone (padrão 20). */
  size?: number;
}

export function Spinner({ className, size = 20 }: SpinnerProps) {
  return (
    <Loader2
      className={cn("animate-spin text-ink-muted", className)}
      style={{ width: size, height: size }}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
