import { DateTime } from 'luxon';
// Funções do shared serão usadas via re-export ou implementação local

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Obtém DateTime atual no timezone de São Paulo
 */
export function getNow(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

/**
 * Converte Date para DateTime no timezone de São Paulo
 */
export function toSaoPauloTime(date: Date): DateTime {
  return DateTime.fromJSDate(date, { zone: TIMEZONE });
}

/**
 * Formata data para exibição (DD/MM/YYYY)
 */
export function formatDate(date: Date | DateTime): string {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  return dt.toFormat('dd/MM/yyyy');
}

/**
 * Formata horário para exibição (HH:mm)
 */
export function formatTime(date: Date | DateTime): string {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  return dt.toFormat('HH:mm');
}

/**
 * Formata data e horário (DD/MM/YYYY HH:mm)
 */
export function formatDateTime(date: Date | DateTime): string {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  return dt.toFormat('dd/MM/yyyy HH:mm');
}

/**
 * Verifica se é hoje
 */
export function isToday(date: Date | DateTime): boolean {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  const now = getNow();
  return dt.hasSame(now, 'day');
}

/**
 * Verifica se é passado
 */
export function isPast(date: Date | DateTime): boolean {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  const now = getNow();
  return dt < now.startOf('day');
}

/**
 * Gera dateKey no formato YYYY-MM-DD
 */
export function getDateKey(date: Date | DateTime): string {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  return dt.toFormat('yyyy-MM-dd');
}

/**
 * Verifica se é domingo
 */
export function isSunday(date: Date | DateTime): boolean {
  const dt = date instanceof DateTime ? date : toSaoPauloTime(date);
  return dt.weekday === 7;
}

/**
 * Valida se o horário está dentro da faixa permitida (08:00 - 18:30)
 */
export function isValidTimeSlot(slotStart: Date | DateTime): boolean {
  const dt = slotStart instanceof DateTime ? slotStart : toSaoPauloTime(slotStart);
  const hour = dt.hour;
  const minute = dt.minute;

  if (hour < 8) return false;
  if (hour > 18 || (hour === 18 && minute > 30)) return false;
  if (minute !== 0 && minute !== 30) return false;

  return true;
}

/**
 * Gera todos os slots de 30min entre startTime e endTime
 */
export function generateSlotsBetween(
  startTime: Date | DateTime,
  endTime: Date | DateTime
): DateTime[] {
  const start = startTime instanceof DateTime ? startTime : toSaoPauloTime(startTime);
  const end = endTime instanceof DateTime ? endTime : toSaoPauloTime(endTime);

  const slots: DateTime[] = [];
  let current = start;

  while (current <= end) {
    slots.push(current);
    current = current.plus({ minutes: 30 });
  }

  return slots;
}

