import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useBranding } from '@/hooks/useBranding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBookingState } from '@/contexts/BookingContext';
import { generateGoogleCalendarUrl } from '@/utils/calendar-ics';
import { BARBERS, BARBERSHOP_WHATSAPP_E164, SERVICE_LABELS } from '@/utils/constants';
import { generateWhatsAppDeepLink } from '@/utils/whatsapp';
import { formatDate, formatTime } from '@/utils/dates';
import { api } from '@/lib/api';

export default function SuccessPage() {
  const { logoSrc } = useBranding();
  const bookingState = useBookingState();
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('bookingId');

  const [serviceLabel, setServiceLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const serviceType = bookingState.serviceType;
    if (!serviceType) {
      setServiceLabel(null);
      return;
    }
    void (async () => {
      try {
        const data = await api.services();
        if (cancelled) return;
        const match = (data.items ?? []).find((s) => s.id === serviceType);
        setServiceLabel(match?.label ?? null);
      } catch {
        if (!cancelled) setServiceLabel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingState.serviceType]);

  const canUseActions =
    !!bookingState.serviceType &&
    !!bookingState.barberId &&
    !!bookingState.selectedSlot &&
    !!bookingState.customerData;

  const barberName = canUseActions
    ? BARBERS.find((b) => b.id === bookingState.barberId)?.name || ''
    : '';
  const customerName = canUseActions
    ? `${bookingState.customerData!.firstName} ${bookingState.customerData!.lastName}`
    : '';

  const googleCalendarUrl = (() => {
    if (bookingId) return `/api/calendar/google?bookingId=${encodeURIComponent(bookingId)}`;
    if (!canUseActions) return null;
    return generateGoogleCalendarUrl(
      bookingState.serviceType!,
      barberName,
      bookingState.selectedSlot!,
      customerName,
      serviceLabel || undefined
    );
  })();

  const icsUrl = (() => {
    if (bookingId) return `/api/calendar/booking.ics?bookingId=${encodeURIComponent(bookingId)}`;
    if (!canUseActions) return null;
    const params = new URLSearchParams({
      serviceType: bookingState.serviceType!,
      customerName,
      slotStart: bookingState.selectedSlot!.toISO() ?? '',
    });
    return `/api/calendar/booking.ics?${params.toString()}`;
  })();

  const cancelUrl = (() => {
    const code = bookingState.cancelCode;
    if (!code) return null;
    return `/cancelar/${encodeURIComponent(code)}`;
  })();

  const barbershopWhatsAppUrl = (() => {
    if (!canUseActions) return null;
    const resolvedServiceLabel = serviceLabel || SERVICE_LABELS[bookingState.serviceType!] || bookingState.serviceType!;
    const dateStr = formatDate(bookingState.selectedSlot!);
    const timeStr = formatTime(bookingState.selectedSlot!);
    const customerWhatsApp = bookingState.customerData!.whatsapp;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const toAbsolute = (url: string | null) => {
      if (!url) return null;
      if (/^https?:\/\//i.test(url)) return url;
      if (!origin) return url;
      return url.startsWith('/') ? `${origin}${url}` : url;
    };

    const icsAbsoluteUrl = toAbsolute(icsUrl);
    const googleAbsoluteUrl = toAbsolute(googleCalendarUrl);
    const cancelAbsoluteUrl = toAbsolute(cancelUrl);

    const lines: string[] = [];
    lines.push('Agendamento confirmado — Sr. Cardoso Barbearia ✅');
    lines.push('');
    lines.push('Detalhes');
    lines.push('');
    lines.push(`Cliente: ${customerName}`);
    lines.push(`WhatsApp: ${customerWhatsApp}`);
    lines.push(`Serviço: ${resolvedServiceLabel}`);
    lines.push(`Barbeiro: ${barberName}`);
    lines.push(`Quando: ${dateStr} às ${timeStr}`);

    const linkLines: string[] = [];
    if (icsAbsoluteUrl) linkLines.push(`Calendário iPhone (.ics): ${icsAbsoluteUrl}`);
    if (googleAbsoluteUrl) linkLines.push(`Google Agenda: ${googleAbsoluteUrl}`);
    if (cancelAbsoluteUrl) linkLines.push(`Cancelar/Remarcar: ${cancelAbsoluteUrl}`);

    if (linkLines.length) {
      lines.push('');
      lines.push('Links');
      lines.push('');
      lines.push(...linkLines);
    }

    const message = lines.join('\n');
    return generateWhatsAppDeepLink(BARBERSHOP_WHATSAPP_E164, message);
  })();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 safe-top-p4 safe-bottom-p4 overflow-x-hidden">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <Link to="/" className="inline-block" aria-label="Ir para a página inicial">
            <img 
              src={logoSrc} 
              alt="Sr. Cardoso Barbearia" 
              className="mx-auto w-40 h-auto"
            />
          </Link>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Seu Ritual está agendado.
          </h1>
          <p className="text-muted-foreground italic">
            "A excelência não é um ato, mas um hábito."
          </p>
        </div>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-serif">Detalhes da Experiência</CardTitle>
            <CardDescription>
              Envie a confirmação para a barbearia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {barbershopWhatsAppUrl ? (
                <Button
                  className="w-full h-auto min-h-10 whitespace-normal py-3 text-center leading-snug"
                  asChild
                >
                  <a href={barbershopWhatsAppUrl} target="_blank" rel="noopener noreferrer">
                    Enviar confirmação no WhatsApp da barbearia
                  </a>
                </Button>
              ) : (
                <Button
                  className="w-full h-auto min-h-10 whitespace-normal py-3 text-center leading-snug"
                  disabled
                >
                  Enviar confirmação no WhatsApp da barbearia
                </Button>
              )}
            </div>
            <Link
              to="/"
              className="block"
              onClick={() => bookingState.clearBooking()}
            >
              <Button className="w-full" variant="secondary">
                Voltar ao início
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
