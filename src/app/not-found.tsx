import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg-page px-6 text-center">
      <SearchX className="size-8 text-ink-muted" strokeWidth={2} aria-hidden="true" />
      <h1 className="text-2xl font-semibold text-ink-primary">Página não encontrada</h1>
      <p className="text-sm text-ink-secondary">
        O endereço acessado não existe ou foi movido.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center justify-center rounded-sm bg-ink-primary px-4 text-sm font-medium text-white transition-transform duration-150 ease-out active:scale-[0.98]"
      >
        Voltar para o início
      </Link>
    </div>
  );
}
