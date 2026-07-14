import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays, startOfDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TIMEZONE } from "./types";

// Banco e DTOs em UTC; todo cálculo de "dia"/"semana" e formatação
// acontecem na parede de America/Sao_Paulo.

export function formatInTz(date: Date | string, fmt: string): string {
  return formatInTimeZone(date, TIMEZONE, fmt, { locale: ptBR });
}

/** "14:00" */
export const formatTime = (d: Date | string) => formatInTz(d, "HH:mm");

/** "segunda-feira, 14 de julho" */
export const formatDayLong = (d: Date | string) =>
  formatInTz(d, "EEEE, d 'de' MMMM");

/** "14/07 14:00" */
export const formatShort = (d: Date | string) => formatInTz(d, "dd/MM HH:mm");

/** Limites UTC do dia local que contém `ref`. */
export function dayBoundsUtc(ref: Date = new Date()): { start: Date; end: Date } {
  const zoned = toZonedTime(ref, TIMEZONE);
  const start = fromZonedTime(startOfDay(zoned), TIMEZONE);
  return { start, end: fromZonedTime(addDays(startOfDay(zoned), 1), TIMEZONE) };
}

/** Limites UTC da semana local (segunda a domingo) que contém `ref`. */
export function weekBoundsUtc(ref: Date = new Date()): { start: Date; end: Date } {
  const zoned = toZonedTime(ref, TIMEZONE);
  const monday = startOfWeek(zoned, { weekStartsOn: 1 });
  return {
    start: fromZonedTime(monday, TIMEZONE),
    end: fromZonedTime(addDays(monday, 7), TIMEZONE),
  };
}

/** "HH:mm" atual na parede local (para comparar com dailySummaryTime). */
export const currentLocalHHmm = () => formatInTz(new Date(), "HH:mm");

/** "2026-07-13" do dia local corrente (chaves de dedupe). */
export const currentLocalDate = () => formatInTz(new Date(), "yyyy-MM-dd");
