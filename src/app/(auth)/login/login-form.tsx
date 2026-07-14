"use client";

import { useActionState } from "react";
import { CircleAlert } from "lucide-react";
import { login } from "@/server/actions/auth";
import { SubmitButton } from "./submit-button";

export function LoginForm() {
  const [state, formAction] = useActionState(login, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-[13px] font-medium text-[var(--ink-secondary,#52514e)]"
        >
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="voce@exemplo.com"
          className="h-10 rounded-lg border border-[var(--border-ring,rgba(11,11,11,0.10))] bg-[var(--bg-surface,#ffffff)] px-3 text-sm text-[var(--ink-primary,#0b0b0b)] outline-none placeholder:text-[var(--ink-muted,#898781)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#2a78d6)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-[13px] font-medium text-[var(--ink-secondary,#52514e)]"
        >
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Sua senha"
          className="h-10 rounded-lg border border-[var(--border-ring,rgba(11,11,11,0.10))] bg-[var(--bg-surface,#ffffff)] px-3 text-sm text-[var(--ink-primary,#0b0b0b)] outline-none placeholder:text-[var(--ink-muted,#898781)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#2a78d6)]"
        />
      </div>

      {state && !state.ok ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-[13px] text-[var(--status-critical,#d03b3b)]"
        >
          <CircleAlert
            className="h-4 w-4 shrink-0"
            strokeWidth={2}
            aria-hidden="true"
          />
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
