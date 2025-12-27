import { DateTime } from 'luxon';

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Obtém DateTime no timezone de São Paulo
 */
export function getNow(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

/**
 * Converte timestamp para DateTime no timezone de São Paulo
 */
export function toSaoPauloTime(timestamp: Date | number): DateTime {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return DateTime.fromJSDate(date, { zone: TIMEZONE });
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
  return dt.weekday === 7; // Luxon: 1 = Monday, 7 = Sunday
}

/**
 * Gera slotId no formato YYYYMMDD_HHmm
 */
export function generateSlotId(slotStart: Date | DateTime): string {
  const dt = slotStart instanceof DateTime ? slotStart : toSaoPauloTime(slotStart);
  return dt.toFormat('yyyyMMdd_HHmm');
}

/**
 * Valida se o horário é um slot válido (múltiplo de 30 minutos)
 * Nota: Não valida o range de horário - isso deve ser feito contra o schedule do barbeiro
 */
export function isValidTimeSlot(slotStart: Date | DateTime): boolean {
  const dt = slotStart instanceof DateTime ? slotStart : toSaoPauloTime(slotStart);
  const minute = dt.minute;

  // Deve ser múltiplo de 30 minutos
  if (minute !== 0 && minute !== 30) {
    return false;
  }

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

/**
 * Extrai MMDD de uma data de aniversário
 */
export function extractBirthdayMmdd(birthday: string): string {
  // birthday está no formato YYYY-MM-DD
  const parts = birthday.split('-');
  if (parts.length !== 3) {
    throw new Error('Formato de data inválido. Use YYYY-MM-DD');
  }
  return `${parts[1]}${parts[2]}`; // MM + DD
}

