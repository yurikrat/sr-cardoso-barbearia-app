import { DateTime } from 'luxon';
import { formatDate, formatTime } from './dates';
import { SERVICE_LABELS } from './constants';

/**
 * Gera mensagem de confirmação de agendamento
 */
export function generateBookingConfirmationMessage(
  customerName: string,
  serviceType: string,
  barberName: string,
  slotStart: DateTime,
  address?: string,
  serviceLabelOverride?: string
): string {
  const serviceLabel = serviceLabelOverride || SERVICE_LABELS[serviceType] || serviceType;
  const dateStr = formatDate(slotStart);
  const timeStr = formatTime(slotStart);
  const addressStr = address || 'Barbearia Sr. Cardoso';

  return `Olá ${customerName}! 

Sua reserva na ${addressStr} está confirmada:

📅 Data: ${dateStr}
🕐 Horário: ${timeStr}
💇 Serviço: ${serviceLabel}
👨‍💼 Barbeiro: ${barberName}

Por favor, chegue 5 minutos antes do horário agendado.

Aguardamos você! ✂️`;
}

/**
 * Gera mensagem de reativação para clientes inativos
 */
export function generateReactivationMessage(customerName: string): string {
  return `Olá ${customerName}! 

Faz um tempo que não te vemos na Barbearia Sr. Cardoso. Que tal agendar um horário?

Acesse nosso link de agendamento e escolha o melhor horário para você! ✂️`;
}

/**
 * Gera mensagem de aniversário
 */
export function generateBirthdayMessage(customerName: string): string {
  return `Olá ${customerName}! 🎉

Feliz aniversário! Que tal comemorar com um corte na Barbearia Sr. Cardoso?

Agende seu horário e venha nos visitar! ✂️🎂`;
}

/**
 * Gera mensagem para clientes que faltaram
 */
export function generateNoShowMessage(customerName: string): string {
  return `Olá ${customerName}! 

Notamos que você não pôde comparecer ao seu agendamento hoje. 

Gostaria de reagendar para outro horário? Acesse nosso link e escolha uma nova data! ✂️`;
}

/**
 * Gera deep link do WhatsApp
 */
export function generateWhatsAppDeepLink(phone: string, text: string): string {
  const phoneClean = phone.replace(/[^0-9]/g, '');
  const textEncoded = encodeURIComponent(text);
  return `https://wa.me/${phoneClean}?text=${textEncoded}`;
}

