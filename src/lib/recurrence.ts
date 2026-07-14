import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { rrulestr } from "rrule";
import { TIMEZONE } from "./types";
import type { RecurrenceFreq } from "./types";

// Expansão de recorrência com a lib `rrule` — specs/04.
//
// Quirk clássico da lib: ela sempre calcula usando os componentes UTC do
// `Date` (getUTCFullYear/getUTCHours/...), ignorando timezone real. Se
// alimentássemos o dtstart/janela como instantes UTC "de verdade", uma
// virada de DST (ou só a diferença de fuso) desalinharia o dia-da-semana/
// hora-do-dia em relação à parede de America/Sao_Paulo.
//
// Solução (mesmo truque já usado em `datetime.ts` via date-fns-tz):
// convertemos os instantes reais para um Date "fake UTC" cujos campos UTC
// são iguais aos campos da parede local (`toZonedTime`), rodamos a
// expansão inteiramente nesse espaço "fake", e convertemos cada resultado
// de volta para UTC real (`fromZonedTime`) — preservando a hora do dia na
// parede local mesmo que o offset do fuso mude entre o dtstart e a
// ocorrência.

const MAX_INSTANCES = 500;

/** Gera a string RRULE (sem DTSTART) a partir da frequência escolhida na criação. */
export function buildRruleString(freq: RecurrenceFreq): string {
  return `FREQ=${freq}`;
}

export interface RecurrenceSource {
  startAt: Date;
  endAt: Date;
  /** String RRULE (ex.: "FREQ=WEEKLY"), com ou sem DTSTART embutido (sync externo). */
  rrule: string;
}

/**
 * Expande um evento recorrente em instâncias dentro da janela [windowStart,
 * windowEnd). Cap de 500 instâncias por chamada (proteção contra regras sem
 * fim + janelas muito largas).
 */
export function expandOccurrences(
  event: RecurrenceSource,
  windowStart: Date,
  windowEnd: Date,
): { start: Date; end: Date }[] {
  if (windowEnd.getTime() <= windowStart.getTime()) return [];
  if (!event.rrule) return [];

  const durationMs = event.endAt.getTime() - event.startAt.getTime();

  const dtstartFake = toZonedTime(event.startAt, TIMEZONE);
  const windowStartFake = toZonedTime(windowStart, TIMEZONE);
  const windowEndFake = toZonedTime(windowEnd, TIMEZONE);

  // Regras vindas de sync externo (onda 3) podem trazer DTSTART embutido no
  // próprio texto — nesse caso preservamos a regra completa e deixamos a
  // lib usar o DTSTART dela. Regras criadas localmente só têm "FREQ=..." e
  // usam o dtstart (já convertido para o espaço "fake UTC") do evento mestre.
  const rule = event.rrule.toUpperCase().includes("DTSTART")
    ? rrulestr(event.rrule)
    : rrulestr(event.rrule, { dtstart: dtstartFake });

  const fakeOccurrences = rule
    .between(windowStartFake, windowEndFake, true)
    // `between(..., inc=true)` inclui o limite superior quando bate exato;
    // a janela é semiaberta ([start, end)), então excluímos esse caso.
    .filter((d) => d.getTime() < windowEndFake.getTime())
    .slice(0, MAX_INSTANCES);

  return fakeOccurrences.map((fakeDate) => {
    const start = fromZonedTime(fakeDate, TIMEZONE);
    return { start, end: new Date(start.getTime() + durationMs) };
  });
}
