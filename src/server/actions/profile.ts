"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import type { ActionResult, ProfileDTO, ProfileUpdateInput } from "@/lib/types";

export async function getProfile(): Promise<ProfileDTO> {
  const { user } = await requireSession();

  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    addressPlaceId: user.addressPlaceId,
    // "Geocodificado" agora significa "tem placeId validado (Places New)" —
    // specs/08. addressLat/Lng são legado do fluxo antigo de Geocoding.
    addressGeocoded: user.addressPlaceId != null,
  };
}

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(120, "Nome muito longo"),
  // Verificação leniente (local@domínio): z.email() estrito rejeitaria
  // endereços locais como "admin@local", usados pelo seed.
  email: z
    .string()
    .trim()
    .max(200, "E-mail muito longo")
    .regex(/^[^\s@]+@[^\s@]+$/, "E-mail inválido"),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  addressPlaceId: z.string().trim().max(300).nullable().optional(),
});

export async function updateProfile(input: ProfileUpdateInput): Promise<ActionResult> {
  const { user } = await requireSession();

  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const { name, email, phone, address, addressPlaceId } = parsed.data;

  if (email.toLowerCase() !== user.email.toLowerCase()) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== user.id) {
      return { ok: false, error: "Já existe uma conta com este e-mail" };
    }
  }

  const nextAddress = address || null;
  const addressChanged = nextAddress !== (user.address ?? null);

  // placeId novo enviado explicitamente (seleção no autocomplete ou texto
  // limpo pela UI) prevalece; se não veio, mas o texto do endereço mudou,
  // o placeId antigo fica obsoleto e é limpo; senão mantém o atual — specs/08.
  const nextAddressPlaceId =
    addressPlaceId !== undefined ? addressPlaceId || null : addressChanged ? null : user.addressPlaceId;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      email,
      phone: phone || null,
      address: nextAddress,
      addressPlaceId: nextAddressPlaceId,
    },
  });

  revalidatePath("/perfil");

  return { ok: true, data: undefined };
}
