// Layout mínimo para rotas públicas de autenticação — sem nav, sem shell do
// app autenticado (esse é responsabilidade da Onda 1A em src/app/(app)/).

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-[var(--bg-page,#f9f9f7)] px-4 py-12">
      {children}
    </div>
  );
}
