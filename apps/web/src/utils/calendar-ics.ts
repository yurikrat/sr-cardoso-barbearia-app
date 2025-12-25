import { DateTime } from 'luxon';
import { SERVICE_LABELS } from './constants';

/**
 * Gera arquivo ICS para download
 */
export function generateICSFile(
  serviceType: string,
  barberName: string,
  slotStart: DateTime,
  customerName: string,
  serviceLabelOverride?: string
): string {
  const serviceLabel = serviceLabelOverride || SERVICE_LABELS[serviceType] || serviceType;
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
  serviceType: string,
  barberName: string,
  slotStart: DateTime,
  customerName: string,
  serviceLabelOverride?: string
): string {
  const serviceLabel = serviceLabelOverride || SERVICE_LABELS[serviceType] || serviceType;
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

  // Prefer Web Share on mobile when available
  const nav = navigator as Navigator & {
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
    canShare?: (data: { files?: File[] }) => boolean;
  };

  try {
    const file = new File([blob], filename, { type: 'text/calendar' });
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      void nav.share({ files: [file], title: 'Agendamento' });
      return;
    }
  } catch {
    // ignore and fallback
  }

  // Fallback: open the ICS in the browser (works better than download on iOS)
  window.location.href = url;

  // Best-effort cleanup
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
