# 08 — Google Maps: distância, tempo de carro e tag "Atrasado"

Tudo server-side em `src/server/integrations/maps.ts` (a chave nunca vai ao cliente). Chave: `Settings.googleMapsApiKey` (descriptografar com `decryptSecret`). Sem chave configurada → todas as funções retornam `null`/`[]` silenciosamente (UI simplesmente não mostra badges nem sugestões).

## Modelo: Places API (New) Autocomplete + Routes API

A Geocoding API foi removida do fluxo. Em vez de geocodificar endereços para lat/lng e calcular rota por coordenadas, o app usa:

1. **Places API (New) Autocomplete** para sugerir endereços enquanto o usuário digita (perfil = origem; local do evento = destino). Ao selecionar uma sugestão, guardamos texto (`description`) + `placeId`.
2. **Routes API** com `placeId` (quando o usuário selecionou uma sugestão) ou endereço em texto livre (fallback, quando não selecionou) — a própria Routes resolve o endereço internamente, sem precisar de um passo de geocoding separado.

`User.addressLat/Lng` e `Event.locationLat/Lng` são **legado** do fluxo antigo (mantidos na tabela, não lidos nem escritos pelo código atual). Os campos vivos são `User.addressPlaceId` e `Event.locationPlaceId`.

## Autocomplete — `autocompletePlaces(input: string): Promise<PlaceSuggestionDTO[]>`

`POST https://places.googleapis.com/v1/places:autocomplete` com `X-Goog-Api-Key` e corpo `{ input, languageCode: "pt-BR", regionCode: "br" }`. Resposta: `suggestions[].placePrediction.{ placeId, text.text }` — mapeada para `{ placeId, description }`, no máximo 5 itens. Sem chave/erro/HTTP não-OK → `[]` (nunca lança).

A UI nunca chama o Google diretamente: `src/server/actions/places.ts` expõe `searchPlaces(query)` (`requireSession`, zod trim/min 3/max 200) para o componente `src/components/ui/address-autocomplete.tsx` (debounce 300 ms, mínimo 3 caracteres, navegação por teclado, fecha ao clicar fora). Selecionar uma sugestão grava `{ text, placeId }`; digitar depois de selecionar zera o `placeId` (o texto volta a ser "livre" até nova seleção).

Usado em dois lugares, ambos passando o par texto+placeId para a server action correspondente:
- Perfil (`src/app/(app)/perfil/perfil-client.tsx`) → `updateProfile({ address, addressPlaceId })`.
- Formulário de evento (`src/components/event-form.tsx`, campo Local) → `createEvent`/`updateEvent` com `{ location, locationPlaceId }`.

Regra de persistência (perfil e evento, mesma lógica duplicada em `profile.ts` e `events.ts`): um novo `placeId` explícito prevalece; se não vier mas o texto do endereço/local mudou em relação ao valor salvo, o `placeId` antigo fica obsoleto e é limpo; caso contrário mantém o valor salvo.

## Rotas — `refreshTravelInfo(eventId): TravelInfoDTO | null`

Routes API v2 `POST https://routes.googleapis.com/directions/v2:computeRoutes` com `X-Goog-Api-Key` e `X-Goog-FieldMask: routes.duration,routes.distanceMeters`:

- **origin**: `{ placeId: User.addressPlaceId }` se houver, senão `{ address: User.address }`; sem nenhum dos dois → `null` (sem chamar a API).
- **destination**: `{ placeId: Event.locationPlaceId }` se houver, senão `{ address: Event.location }`; evento sem `location` → `null` (checado antes de tudo).
- `travelMode: DRIVE`, `routingPreference: TRAFFIC_AWARE`, `departureTime`: agora (ISO; obrigatório ser futuro).
- Sucesso: persistir `travelDurationMin` (arredondar para cima), `travelDistanceKm` (1 casa), `travelCheckedAt = now`.
- Falha de rede/timeout/HTTP inesperado ("error"): **não** grava nada — mantém o cache antigo, permitindo nova tentativa no próximo ciclo.
- Endereço/placeId não resolvível pela Routes (HTTP 400 ou resposta 200 sem rota, "unresolvable"): grava só `travelCheckedAt` (sem tocar `travelDurationMin`/`travelDistanceKm`), para não repetir a tentativa por endereço provavelmente inválido a cada ciclo curto.

## Política de atualização (economia de quota)

`refreshTravelForUpcoming()`: eventos/ocorrências **com location**, começando entre agora e **+12 h**. Cache válido por **10 min** (`travelCheckedAt`) no caminho de sucesso; quando o cache tem `travelCheckedAt` mas `travelDurationMin == null` (heurística de "endereço não resolvível"), a folga é de **1 h** antes de repetir. Chamada: pelo cron a cada 10 min (specs/09) e best-effort no load do dashboard. Nunca chamar por evento passado ou sem location. Timeout fetch 5 s; falha → manter cache antigo, log `console.warn`.

## Tag "Atrasado"

Calculada na leitura (`getOccurrences`/`getUpcomingEvents`): para ocorrência futura com `travelDurationMin`:
`lateByMin = ceil((now + durationMin*60s − start) / 60s)`; se ≤ 0 → null (chega a tempo). Exibição (specs/05): badge crítica "Atrasado {n} min" substitui o badge normal de viagem. Tag só para ocorrências ainda não iniciadas.

## Alerta de atraso (integração com specs/09)

Após cada `refreshTravelForUpcoming()` do cron: para eventos nas próximas **3 h** que fliparam para atrasado (lateByMin ≥ 5), chamar `sendLateAlert(eventId, lateByMin)` — dedupe por `late:<eventId>:<occurrenceStartISO>` no NotificationLog.
