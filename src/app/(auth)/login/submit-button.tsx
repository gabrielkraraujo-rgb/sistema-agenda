"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ink-primary,#0b0b0b)] text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {pending ? (
        <>
          <LoaderCircle
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
            strokeWidth={2}
            aria-hidden="true"
          />
          Entrando...
        </>
      ) : (
        "Entrar"
      )}
    </button>
  );
}
