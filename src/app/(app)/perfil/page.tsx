import { getProfile } from "@/server/actions/profile";
import { PerfilClient } from "./perfil-client";

export default async function PerfilPage() {
  const profile = await getProfile();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="hidden text-2xl font-semibold text-ink-primary md:block">Perfil</h1>
      <PerfilClient initialProfile={profile} />
    </div>
  );
}
