"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { autocompletePlaces } from "@/server/integrations/maps";
import type { PlaceSuggestionDTO } from "@/lib/types";

const searchPlacesSchema = z.string().trim().min(3).max(200);

/** Sugestões de endereço para os campos de autocomplete (perfil/evento) —
 * specs/08. A chave do Google nunca vai ao navegador: a UI chama esta
 * action, que por sua vez chama `autocompletePlaces` no servidor. */
export async function searchPlaces(query: string): Promise<PlaceSuggestionDTO[]> {
  await requireSession();

  const parsed = searchPlacesSchema.safeParse(query);
  if (!parsed.success) return [];

  return autocompletePlaces(parsed.data);
}
