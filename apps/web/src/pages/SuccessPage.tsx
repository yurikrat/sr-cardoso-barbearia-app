import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBookingState } from '@/contexts/BookingContext';
import { generateICSFile, generateGoogleCalendarUrl, downloadICSFile } from '@/utils/calendar-ics';
import { BARBERS } from '@/utils/constants';

export default function SuccessPage() {
  const bookingState = useBookingState();

  const handleAddToCalendar = () => {
    if (
      !bookingState.serviceType ||
      !bookingState.barberId ||
      !bookingState.selectedSlot ||
      !bookingState.customerData
    ) {
      return;
    }

    const barberName =
      BARBERS.find((b) => b.id === bookingState.barberId)?.name || '';
    const customerName = `${bookingState.customerData.firstName} ${bookingState.customerData.lastName}`;

    const icsContent = generateICSFile(
      bookingState.serviceType,
      barberName,
      bookingState.selectedSlot,
      customerName
    );

    downloadICSFile(icsContent, 'agendamento-sr-cardoso.ics');
  };

  const handleAddToGoogleCalendar = () => {
    if (
      !bookingState.serviceType ||
      !bookingState.barberId ||
      !bookingState.selectedSlot ||
      !bookingState.customerData
    ) {
      return;
    }

    const barberName =
      BARBERS.find((b) => b.id === bookingState.barberId)?.name || '';
    const customerName = `${bookingState.customerData.firstName} ${bookingState.customerData.lastName}`;

    const url = generateGoogleCalendarUrl(
      bookingState.serviceType,
      barberName,
      bookingState.selectedSlot,
      customerName
    );

    window.open(url, '_blank');
  };

  // Limpar estado após exibir sucesso
  useEffect(() => {
    const timer = setTimeout(() => {
      bookingState.clearBooking();
    }, 5000);

    return () => clearTimeout(timer);
  }, [bookingState]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 safe-top safe-bottom">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="text-6xl">✓</div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Reserva confirmada!
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Próximos passos</CardTitle>
            <CardDescription>
              Você receberá a confirmação pelo WhatsApp da barbearia em breve.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={handleAddToCalendar}
              >
                Adicionar ao calendário (iOS/Android)
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={handleAddToGoogleCalendar}
              >
                Adicionar ao Google Calendar
              </Button>
            </div>
            <Link to="/" className="block">
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
