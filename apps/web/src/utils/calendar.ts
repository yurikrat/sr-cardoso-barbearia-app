import { DateTime } from 'luxon';
import { isPast, isSunday } from './dates';

/**
 * Verifica se uma data deve ser desabilitada no calendário (passado ou domingo)
 */
export function isDateDisabled(date: Date): boolean {
  const dt = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' });
  return isSunday(dt) || isPast(dt);
}

/**
 * Filtro para o react-day-picker
 */
export function disabledDays(date: Date): boolean {
  return isDateDisabled(date);
}


