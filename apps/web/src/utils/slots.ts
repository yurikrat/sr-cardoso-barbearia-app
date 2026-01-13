import { DateTime } from 'luxon';
import { generateSlotsBetween } from './dates';

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Gera todos os slots disponíveis de um dia (09:00 até 19:00, intervalos de 30min)
 * O horário final é 19:30 (exclusive), gerando slots até 19:00 (último cliente)
 */
export function generateDaySlots(date: Date | DateTime): DateTime[] {
  const dt = date instanceof DateTime ? date : DateTime.fromJSDate(date, { zone: TIMEZONE });
  
  const start = dt.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  const end = dt.set({ hour: 19, minute: 30, second: 0, millisecond: 0 }); // 19:30 exclusive = last slot 19:00
  
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

