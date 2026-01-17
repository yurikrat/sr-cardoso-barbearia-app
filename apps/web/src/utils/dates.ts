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
 * Valida se o horário está dentro da faixa permitida (09:00 - 19:00)
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
 * @param startTime - Início (inclusive)
 * @param endTime - Fim (exclusive) - não inclui o slot que começa em endTime
 */
export function generateSlotsBetween(
  startTime: Date | DateTime,
  endTime: Date | DateTime
): DateTime[] {
  const start = startTime instanceof DateTime ? startTime : toSaoPauloTime(startTime);
  const end = endTime instanceof DateTime ? endTime : toSaoPauloTime(endTime);

  const slots: DateTime[] = [];
  let current = start;

  while (current < end) {
    slots.push(current);
    current = current.plus({ minutes: 30 });
  }

  return slots;
}

/**
 * Aplica máscara de data brasileira (DD/MM/YYYY) em input de texto
 * Aceita entrada tipo "30031999" e formata para "30/03/1999"
 */
export function applyBirthDateMask(value: string): string {
  // Remove tudo que não é dígito
  const digits = value.replace(/\D/g, '');
  
  // Limita a 8 dígitos (DDMMYYYY)
  const limited = digits.slice(0, 8);
  
  // Aplica a máscara DD/MM/YYYY
  if (limited.length <= 2) {
    return limited;
  } else if (limited.length <= 4) {
    return `${limited.slice(0, 2)}/${limited.slice(2)}`;
  } else {
    return `${limited.slice(0, 2)}/${limited.slice(2, 4)}/${limited.slice(4)}`;
  }
}

/**
 * Converte data no formato DD/MM/YYYY para YYYY-MM-DD (formato ISO para input type="date")
 */
export function birthDateToISO(maskedDate: string): string {
  const digits = maskedDate.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  
  // Validação básica
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) {
    return '';
  }
  
  return `${year}-${month}-${day}`;
}

/**
 * Valida se a data de nascimento mascarada é válida
 */
export function isValidBirthDate(maskedDate: string): boolean {
  const iso = birthDateToISO(maskedDate);
  if (!iso) return false;
  
  const dt = DateTime.fromISO(iso, { zone: TIMEZONE });
  if (!dt.isValid) return false;
  
  // Deve ser no passado e razoável (não antes de 1900)
  const now = getNow();
  return dt < now && dt.year >= 1900;
}

