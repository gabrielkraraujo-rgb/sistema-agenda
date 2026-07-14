// Google Maps (Places API New — Autocomplete + Routes API) — specs/08.
// Contrato: sem chave configurada, tudo retorna null/[]/no-op silencioso.
// Assinaturas CONGELADAS: actions e scheduler já chamam estas funções.

import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getSettingsRow } from "@/server/actions/settings";
import { collectOccurrences } from "@/server/occurrences";
import type { PlaceSuggestionDTO, TravelInfoDTO } from "@/lib/types";

const FETCH_TIMEOUT_MS = 5_000;
const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000; // specs/08: próximas 12h
const CACHE_TTL_MS = 10 * 60 * 1000; // specs/08: cache válido por 10 min
// Endereço/placeId não resolvível pela Routes API (400/sem rota): folga maior
// antes de tentar de novo, para não bater na API repetidamente por um
// endereço que provavelmente segue inválido — specs/08.
const UNRESOLVABLE_ADDRESS_TTL_MS = 60 * 60 * 1000;
// departureTime precisa ser estritamente futuro (Routes API) — 30s de folga.
const DEPARTURE_LEAD_MS = 30_000;
const MAX_SUGGESTIONS = 5;

// ── Helpers puros (exportados para teste) ────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse do formato de duração da Routes API v2, ex.: "1234s" -> 1234. */
export function parseDurationSeconds(duration: unknown): number | null {
  if (typeof duration !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Parse da resposta de `computeRoutes` (field mask routes.duration,routes.distanceMeters). */
export function parseComputeRoutesResponse(
  json: unknown,
): { durationSec: number; distanceMeters: number } | null {
  if (!isRecord(json)) return null;

  const routes = json.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const first = routes[0];
  if (!isRecord(first)) return null;

  const durationSec = parseDurationSeconds(first.duration);
  const distanceMeters = first.distanceMeters;
  if (durationSec == null || typeof distanceMeters !== "number") return null;

  return { durationSec, distanceMeters };
}

/** Parse da resposta de `places:autocomplete` (Places API New). Formato:
 * `{ suggestions: [{ placePrediction: { placeId, text: { text } } }] }`.
 * Máximo `MAX_SUGGESTIONS` itens; entradas malformadas são ignoradas. */
export function parsePlaceAutocompleteResponse(json: unknown): PlaceSuggestionDTO[] {
  if (!isRecord(json)) return [];

  const suggestions = json.suggestions;
  if (!Array.isArray(suggestions)) return [];

  const result: PlaceSuggestionDTO[] = [];
  for (const item of suggestions) {
    if (result.length >= MAX_SUGGESTIONS) break;
    if (!isRecord(item)) continue;

    const prediction = item.placePrediction;
    if (!isRecord(prediction)) continue;

    const placeId = prediction.placeId;
    if (typeof placeId !== "string" || !placeId) continue;

    const text = prediction.text;
    if (!isRecord(text) || typeof text.text !== "string") continue;

    result.push({ placeId, description: text.text });
  }
  return result;
}

/**
 * `lateByMin` prevista para uma ocorrência ainda não iniciada — mesma regra
 * de `src/server/occurrences.ts` (`buildTravel`), duplicada aqui porque
 * `refreshTravelInfo` só recebe o evento (sem o horário da ocorrência
 * exibida) e não deve importar de `occurrences.ts`.
 */
function computeLateByMin(
  eventStart: Date,
  durationMin: number,
  now: Date,
): number | null {
  if (eventStart.getTime() <= now.getTime()) return null; // já iniciado
  const arrivalMs = now.getTime() + durationMin * 60_000;
  const diffMin = Math.ceil((arrivalMs - eventStart.getTime()) / 60_000);
  return diffMin > 0 ? diffMin : null;
}

// ── Infra HTTP ────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Chave descriptografada de Settings, ou null se não configurada (nunca logar a chave). */
async function getMapsApiKey(): Promise<string | null> {
  const settings = await getSettingsRow();
  if (!settings.googleMapsApiKey) return null;
  try {
    return decryptSecret(settings.googleMapsApiKey);
  } catch {
    console.warn("[maps] falha ao descriptografar a chave configurada (payload inválido)");
    return null;
  }
}

// ── Places Autocomplete (New) ────────────────────────────────────────────

/** Sugestões de endereço via Places API (New) Autocomplete. Server-only — a
 * chave nunca vai ao navegador (a UI chama `searchPlaces`, specs/08). */
export async function autocompletePlaces(input: string): Promise<PlaceSuggestionDTO[]> {
  const apiKey = await getMapsApiKey();
  if (!apiKey) return [];

  try {
    const res = await fetchWithTimeout(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({ input, languageCode: "pt-BR", regionCode: "br" }),
      },
      FETCH_TIMEOUT_MS,
    );

    if (!res.ok) {
      console.warn(`[maps] autocompletePlaces: HTTP ${res.status}`);
      return [];
    }

    const json: unknown = await res.json();
    return parsePlaceAutocompleteResponse(json);
  } catch (err) {
    console.warn("[maps] autocompletePlaces falhou:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

/** Waypoint da Routes API v2: placeId validado (Places New) ou endereço em
 * texto livre como fallback — specs/08. */
type RouteWaypoint = { placeId: string } | { address: string };

function resolveWaypoint(placeId: string | null, address: string | null): RouteWaypoint | null {
  if (placeId) return { placeId };
  if (address) return { address };
  return null;
}

type ComputeRouteResult =
  | { ok: true; durationSec: number; distanceMeters: number }
  // "unresolvable": Google não conseguiu resolver o placeId/endereço em uma
  // localização válida (HTTP 400 ou resposta sem rota) — specs/08.
  // "error": falha de rede/timeout/HTTP inesperado — retry no próximo ciclo.
  | { ok: false; reason: "unresolvable" | "error" };

async function computeRoute(
  apiKey: string,
  origin: RouteWaypoint,
  destination: RouteWaypoint,
): Promise<ComputeRouteResult> {
  const departureTime = new Date(Date.now() + DEPARTURE_LEAD_MS).toISOString();

  const payload = {
    origin,
    destination,
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    departureTime,
  };

  try {
    const res = await fetchWithTimeout(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify(payload),
      },
      FETCH_TIMEOUT_MS,
    );

    if (res.status === 400) {
      // Endereço/placeId inválido ou não resolvível pela Routes API.
      console.warn("[maps] computeRoutes: HTTP 400 (endereço não resolvível)");
      return { ok: false, reason: "unresolvable" };
    }
    if (!res.ok) {
      console.warn(`[maps] computeRoutes: HTTP ${res.status}`);
      return { ok: false, reason: "error" };
    }

    const json: unknown = await res.json();
    const parsed = parseComputeRoutesResponse(json);
    if (!parsed) {
      // Resposta 200 sem rota válida — mesma causa raiz de um 400 (endereço
      // não resolvível/sem rota possível): trata com a mesma folga de TTL.
      console.warn("[maps] computeRoutes: resposta sem rota válida");
      return { ok: false, reason: "unresolvable" };
    }
    return { ok: true, ...parsed };
  } catch (err) {
    console.warn("[maps] computeRoutes falhou:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "error" };
  }
}

/** Calcula e cacheia no Event a rota perfil → local do evento. */
export async function refreshTravelInfo(
  eventId: string,
): Promise<TravelInfoDTO | null> {
  const apiKey = await getMapsApiKey();
  if (!apiKey) return null;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || !event.location) return null;

  // Usuário único (specs/00) — sem endereço de origem (placeId ou texto),
  // não há como calcular a rota.
  const profile = await prisma.user.findFirst();
  if (!profile) return null;

  const origin = resolveWaypoint(profile.addressPlaceId, profile.address);
  if (!origin) return null;

  const destination = resolveWaypoint(event.locationPlaceId, event.location);
  if (!destination) return null;

  const result = await computeRoute(apiKey, origin, destination);

  if (!result.ok) {
    if (result.reason === "unresolvable") {
      // Carimba travelCheckedAt mesmo sem rota, para não repetir a
      // tentativa a cada ciclo curto — specs/08 (ver UNRESOLVABLE_ADDRESS_TTL_MS).
      await prisma.event.update({
        where: { id: eventId },
        data: { travelCheckedAt: new Date() },
      });
    }
    // Falha genérica (timeout/erro da API): mantém o cache antigo, não
    // sobrescreve travelCheckedAt, para permitir nova tentativa no próximo
    // ciclo — specs/08.
    return null;
  }

  const travelDurationMin = Math.ceil(result.durationSec / 60);
  const travelDistanceKm = Math.round((result.distanceMeters / 1000) * 10) / 10;
  const travelCheckedAt = new Date();

  await prisma.event.update({
    where: { id: eventId },
    data: { travelDurationMin, travelDistanceKm, travelCheckedAt },
  });

  return {
    durationMin: travelDurationMin,
    distanceKm: travelDistanceKm,
    lateByMin: computeLateByMin(event.startAt, travelDurationMin, travelCheckedAt),
  };
}

// ── Atualização em lote (cron/dashboard) ────────────────────────────────

/** Atualiza o cache de rota dos eventos das próximas 12h (cron/dashboard). */
export async function refreshTravelForUpcoming(): Promise<void> {
  const apiKey = await getMapsApiKey();
  if (!apiKey) return;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_MS);

  let occurrences;
  try {
    // Janela semiaberta [now, now+12h) — nunca inclui ocorrências passadas.
    occurrences = await collectOccurrences(now, windowEnd);
  } catch (err) {
    console.warn(
      "[maps] refreshTravelForUpcoming: collectOccurrences falhou:",
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  const eventIds = [
    ...new Set(
      occurrences.filter((occ) => !!occ.location).map((occ) => occ.eventId),
    ),
  ];
  if (eventIds.length === 0) return;

  const cacheRows = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, travelCheckedAt: true, travelDurationMin: true },
  });
  const cacheById = new Map(cacheRows.map((row) => [row.id, row]));

  for (const eventId of eventIds) {
    const cache = cacheById.get(eventId);
    if (cache?.travelCheckedAt) {
      const ttlMs = cache.travelDurationMin == null ? UNRESOLVABLE_ADDRESS_TTL_MS : CACHE_TTL_MS;
      if (now.getTime() - cache.travelCheckedAt.getTime() < ttlMs) continue; // cache válido
    }

    try {
      await refreshTravelInfo(eventId);
    } catch (err) {
      console.warn(
        `[maps] refreshTravelForUpcoming: evento ${eventId} falhou:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
