// Registro do agendador no boot do servidor — specs/09 (Onda 3D).
// Localização: Next 16 com pasta src/ detecta a convenção APENAS em
// src/instrumentation.ts (mesmo nível de app/, como middleware/proxy);
// um instrumentation.ts na raiz seria ignorado pelo build e pelo dev.

export async function register(): Promise<void> {
  // Só no runtime Node (nunca no Edge) e nunca durante `next build`.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Guard global contra duplo registro (HMR/dev reload reexecuta register,
  // mas o globalThis do processo sobrevive).
  const flags = globalThis as typeof globalThis & {
    __schedulerStarted?: boolean;
  };
  if (flags.__schedulerStarted) return;
  flags.__schedulerStarted = true;

  try {
    // Import dinâmico: mantém node-cron/Prisma fora do bundle Edge.
    const { startScheduler } = await import("@/server/scheduler");
    startScheduler();
  } catch (err) {
    // Nunca derrubar o boot do servidor por causa do agendador.
    flags.__schedulerStarted = false;
    console.error("[scheduler] falha ao iniciar no register():", err);
  }
}
