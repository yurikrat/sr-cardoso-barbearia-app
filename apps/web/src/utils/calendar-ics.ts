import { DateTime } from 'luxon';
import type { ServiceType } from '@sr-cardoso/shared';

const SERVICE_LABELS: Record<ServiceType, string> = {
  cabelo: 'Corte de Cabelo',
  barba: 'Barba',
  cabelo_barba: 'Corte de Cabelo + Barba',
};

/**
 * Gera arquivo ICS para download
 */
export function generateICSFile(
  serviceType: ServiceType,
  barberName: string,
  slotStart: DateTime,
  customerName: string
): string {
  const serviceLabel = SERVICE_LABELS[serviceType];
  const slotEnd = slotStart.plus({ minutes: 30 });
  
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sr Cardoso Barbearia//Booking System//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${slotStart.toISO()}-${Math.random().toString(36).substr(2, 9)}@sr-cardoso.com`,
    `DTSTAMP:${DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
    `DTSTART:${slotStart.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
    `DTEND:${slotEnd.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
    `SUMMARY:${serviceLabel} - ${barberName}`,
    `DESCRIPTION:Agendamento na Barbearia Sr. Cardoso\\n\\nServiço: ${serviceLabel}\\nBarbeiro: ${barberName}\\nCliente: ${customerName}`,
    'LOCATION:Barbearia Sr. Cardoso',
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return icsContent;
}

/**
 * Gera URL do Google Calendar
 */
export function generateGoogleCalendarUrl(
  serviceType: ServiceType,
  barberName: string,
  slotStart: DateTime,
  customerName: string
): string {
  const serviceLabel = SERVICE_LABELS[serviceType];
  const slotEnd = slotStart.plus({ minutes: 30 });
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${serviceLabel} - ${barberName}`,
    dates: `${slotStart.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}/${slotEnd.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
    details: `Agendamento na Barbearia Sr. Cardoso\n\nServiço: ${serviceLabel}\nBarbeiro: ${barberName}\nCliente: ${customerName}`,
    location: 'Barbearia Sr. Cardoso',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Faz download do arquivo ICS
 */
export function downloadICSFile(icsContent: string, filename: string = 'agendamento.ics'): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
