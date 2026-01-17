/**
 * Constantes da aplicação
 */

export const APP_NAME = 'Sr. Cardoso Barbearia';
export const APP_SHORT_NAME = 'Sr. Cardoso';

export const BARBERS = [
  { id: 'emanuel-fernandes', name: 'Emanuel Fernandes', image: '/barbers/emanuel.png' },
  { id: 'sr-cardoso', name: 'Sr Cardoso', image: '/barbers/waldenio.png' },
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

/**
 * Horários de funcionamento
 * 
 * PUBLIC: disponibilidade para agendamento do cliente (09:00-19:00)
 * ADMIN: janela ampliada para o admin registrar encaixes/atendimentos fora do horário (07:30-20:30)
 */
export const BUSINESS_HOURS = {
  // Horário público (agendamento do cliente)
  PUBLIC: {
    START_HOUR: 9,
    START_MINUTE: 0,
    END_HOUR: 19,
    END_MINUTE: 0,
  },
  // Janela ampliada para admin (registrar atendimentos/encaixes)
  ADMIN: {
    START_HOUR: 7,
    START_MINUTE: 30,
    END_HOUR: 20,
    END_MINUTE: 30,
  },
  SLOT_DURATION: 30, // minutos
};

/**
 * Gera array de slots de horário para o admin (07:30 até 20:00)
 * Último slot é 20:00 pois o atendimento vai até 20:30
 */
export const ADMIN_TIME_SLOTS = (() => {
  const slots: string[] = [];
  let h: number = BUSINESS_HOURS.ADMIN.START_HOUR;
  let m: number = BUSINESS_HOURS.ADMIN.START_MINUTE;
  const endH = BUSINESS_HOURS.ADMIN.END_HOUR;
  const endM = BUSINESS_HOURS.ADMIN.END_MINUTE;
  
  while (h < endH || (h === endH && m < endM)) {
    slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    m += 30;
    if (m >= 60) {
      h++;
      m = 0;
    }
  }
  return slots;
})();

/**
 * Gera array de slots para horário final do admin (08:00 até 20:30)
 */
export const ADMIN_END_TIME_SLOTS = (() => {
  const slots: string[] = [];
  let h: number = BUSINESS_HOURS.ADMIN.START_HOUR;
  let m: number = BUSINESS_HOURS.ADMIN.START_MINUTE + 30;
  if (m >= 60) { h++; m = 0; }
  
  const endH = BUSINESS_HOURS.ADMIN.END_HOUR;
  const endM = BUSINESS_HOURS.ADMIN.END_MINUTE;
  
  while (h < endH || (h === endH && m <= endM)) {
    slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    m += 30;
    if (m >= 60) {
      h++;
      m = 0;
    }
  }
  return slots;
})();

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

