import type { ServiceType } from '@sr-cardoso/shared';
import { DateTime } from 'luxon';
import { formatDate, formatTime } from './dates';

const SERVICE_LABELS: Record<ServiceType, string> = {
  cabelo: 'Corte de Cabelo',
  barba: 'Barba',
  cabelo_barba: 'Corte de Cabelo + Barba',
};

/**
 * Gera mensagem de confirmação de agendamento
 */
export function generateBookingConfirmationMessage(
  customerName: string,
  serviceType: ServiceType,
  barberName: string,
  slotStart: DateTime,
  address?: string
): string {
  const serviceLabel = SERVICE_LABELS[serviceType];
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
 * Gera deep link do WhatsApp
 */
export function generateWhatsAppDeepLink(phone: string, text: string): string {
  const phoneClean = phone.replace(/[^0-9]/g, '');
  const textEncoded = encodeURIComponent(text);
  return `https://wa.me/${phoneClean}?text=${textEncoded}`;
}

