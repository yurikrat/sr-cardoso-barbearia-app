import { DateTime } from 'luxon';
import { generateSlotsBetween } from './dates';

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Gera todos os slots disponíveis de um dia (08:00 até 18:30, intervalos de 30min)
 */
export function generateDaySlots(date: Date | DateTime): DateTime[] {
  const dt = date instanceof DateTime ? date : DateTime.fromJSDate(date, { zone: TIMEZONE });
  
  const start = dt.set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  const end = dt.set({ hour: 18, minute: 30, second: 0, millisecond: 0 });
  
  return generateSlotsBetween(start, end);
}

/**
 * Formata slot para exibição (HH:mm)
 */
export function formatSlot(slot: DateTime): string {
  return slot.toFormat('HH:mm');
}

/**
 * Verifica se um slot está no passado (comparando com agora)
 */
export function isSlotPast(slot: DateTime): boolean {
  const now = DateTime.now().setZone(TIMEZONE);
  return slot < now;
}

/**
 * Gera slotId no formato YYYYMMDD_HHmm
 */
export function generateSlotId(slot: DateTime): string {
  return slot.toFormat('yyyyMMdd_HHmm');
}

