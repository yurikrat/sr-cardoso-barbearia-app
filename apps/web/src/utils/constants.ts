/**
 * Constantes da aplicação
 */

export const APP_NAME = 'Sr. Cardoso Barbearia';
export const APP_SHORT_NAME = 'Sr. Cardoso';

export const BARBERS = [
  { id: 'sr-cardoso', name: 'Sr Cardoso' },
  { id: 'emanuel-fernandes', name: 'Emanuel Fernandes' },
] as const;

export const SERVICE_TYPES = {
  CABELO: 'cabelo',
  BARBA: 'barba',
  CABELO_BARBA: 'cabelo_barba',
} as const;

export const SERVICE_LABELS: Record<string, string> = {
  cabelo: 'Cabelo',
  barba: 'Barba',
  cabelo_barba: 'Cabelo + Barba',
};

export const TIMEZONE = 'America/Sao_Paulo';

// WhatsApp oficial da barbearia (E.164)
export const BARBERSHOP_WHATSAPP_E164 = '+557998016908';

export const BUSINESS_HOURS = {
  START: 8,
  END: 19,
  SLOT_DURATION: 30, // minutos
} as const;

export const BOOKING_STATUS = {
  BOOKED: 'booked',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const;

export const WHATSAPP_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;

