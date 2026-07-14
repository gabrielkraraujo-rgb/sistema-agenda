import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — Agenda",
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-[400px] rounded-xl border border-[var(--hairline,#e1e0d9)] bg-[var(--bg-surface,#ffffff)] p-8 shadow-[0_1px_2px_rgba(11,11,11,0.05)]">
      <h1 className="text-2xl font-semibold text-[var(--ink-primary,#0b0b0b)]">
        Agenda
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted,#898781)]">
        Entre com seu e-mail e senha para continuar.
      </p>

      <div className="mt-6">
        <LoginForm />
      </div>
    </div>
  );
}
