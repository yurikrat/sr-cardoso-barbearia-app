import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { BlockSlotsModal } from '@/components/admin/BlockSlotsModal';
import { formatTime } from '@/utils/dates';
import { DateTime } from 'luxon';
import type { ServiceType } from '@sr-cardoso/shared';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/components/ui/use-toast';
import { adminCancelBookingFn, adminMarkWhatsappSentFn } from '@/lib/firebase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateBookingConfirmationMessage, generateWhatsAppDeepLink } from '@/utils/whatsapp';
import { Calendar as CalendarIcon } from 'lucide-react';
import { BARBERS } from '@/utils/constants';
import { debugLog } from '@/utils/debugLog';

const TIME_SLOTS = Array.from({ length: 22 }, (_, i) => {
  const hour = 8 + Math.floor(i / 2);
  const minute = (i % 2) * 30;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}).filter((time) => {
  const [h, m] = time.split(':').map(Number);
  return h < 19 || (h === 18 && m <= 30);
});

interface Booking {
  id: string;
  barberId?: string;
  customer: { firstName: string; lastName: string; whatsappE164: string };
  serviceType: string;
  slotStart: Date;
  status: string;
  whatsappStatus: string;
}

export default function AgendaDayPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedBarber, setSelectedBarber] = useState<string>('sr-cardoso');
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  const dateKey = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).toFormat('yyyy-MM-dd');

  useEffect(() => {
    loadBookings();
  }, [selectedDate, selectedBarber]);

  const loadBookings = async () => {
    setLoading(true);
    try {
      const bookingsMap: Record<string, Booking> = {};
      const { items } = await api.admin.listBookings(selectedBarber, dateKey);
      items.forEach((raw) => {
        const data = raw as {
          id?: unknown;
          barberId?: unknown;
          customer?: unknown;
          serviceType?: unknown;
          slotStart?: unknown;
          status?: unknown;
          whatsappStatus?: unknown;
        };
        const slotStartIso = typeof data.slotStart === 'string' ? data.slotStart : null;
        if (!slotStartIso) return;
        const slotStart = DateTime.fromISO(slotStartIso, { zone: 'America/Sao_Paulo' }).toJSDate();
        const timeKey = DateTime.fromJSDate(slotStart, { zone: 'America/Sao_Paulo' }).toFormat('HH:mm');
        bookingsMap[timeKey] = {
          id: String(data.id ?? ''),
          barberId: typeof data.barberId === 'string' ? data.barberId : undefined,
          customer: data.customer as Booking['customer'],
          serviceType: String(data.serviceType ?? ''),
          slotStart,
          status: String(data.status ?? ''),
          whatsappStatus: String(data.whatsappStatus ?? ''),
        };
      });

      setBookings(bookingsMap);
    } catch (error: unknown) {
      console.error('Error loading bookings:', error);
      const err = error as { name?: unknown; code?: unknown; message?: unknown };
      // #region agent log
      debugLog({
        sessionId: 'debug-session',
        runId: 'run3',
        hypothesisId: 'H4',
        location: 'apps/web/src/pages/admin/AgendaDayPage.tsx:loadBookings:catch',
        message: 'admin load bookings failed',
        data: {
          selectedBarber,
          dateKey,
          errorName: typeof err?.name === 'string' ? err.name : null,
          errorCode: typeof err?.code === 'string' ? err.code : null,
          errorMessage: typeof err?.message === 'string' ? err.message : null,
        },
        timestamp: Date.now(),
      });
      // #endregion
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar a agenda.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const result = await adminCancelBookingFn({ bookingId });
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      loadBookings();
      setSelectedBooking(null);
      toast({
        title: 'Sucesso',
        description: 'Reserva cancelada com sucesso.',
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : null;
      toast({
        title: 'Erro',
        description: message || 'Erro ao cancelar reserva.',
        variant: 'destructive',
      });
    },
  });

  const markWhatsappSentMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const result = await adminMarkWhatsappSentFn({ bookingId });
      return result.data;
    },
    onSuccess: () => {
      loadBookings();
      setSelectedBooking(null);
      toast({
        title: 'Sucesso',
        description: 'WhatsApp marcado como enviado.',
      });
    },
  });

  const handleSendWhatsApp = (booking: Booking) => {
    const barberName = BARBERS.find((b) => b.id === booking.barberId)?.name || 'Barbeiro';
    const slotStart = DateTime.fromJSDate(booking.slotStart, { zone: 'America/Sao_Paulo' });
    const customerName = `${booking.customer.firstName} ${booking.customer.lastName}`;
    
    const message = generateBookingConfirmationMessage(
      customerName,
      booking.serviceType as ServiceType,
      barberName,
      slotStart
    );
    
    const url = generateWhatsAppDeepLink(booking.customer.whatsappE164, message);
    window.open(url, '_blank');
    markWhatsappSentMutation.mutate(booking.id);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <h2 className="text-2xl font-serif font-bold">Agenda do Dia</h2>
          <div className="flex gap-2">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              className="rounded-md border"
            />
            <Button
              variant="outline"
              onClick={() => setBlockModalOpen(true)}
              className="flex items-center gap-2"
            >
              <CalendarIcon className="h-4 w-4" />
              Bloquear Horários
            </Button>
          </div>
        </div>

        <Tabs value={selectedBarber} onValueChange={setSelectedBarber}>
          <TabsList>
            {BARBERS.map((barber) => (
              <TabsTrigger key={barber.id} value={barber.id}>
                {barber.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {BARBERS.map((barber) => (
            <TabsContent key={barber.id} value={barber.id} className="space-y-4">
              {loading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : (
                <div className="space-y-2">
                  {TIME_SLOTS.map((time) => {
                    const booking = bookings[time];
                    return (
                      <Card
                        key={time}
                        className={`cursor-pointer transition-colors ${
                          booking ? 'hover:bg-accent' : 'opacity-50'
                        }`}
                        onClick={() => booking && setSelectedBooking(booking)}
                      >
                        <CardContent className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <span className="font-mono text-lg font-semibold w-20">{time}</span>
                            {booking ? (
                              <div>
                                <p className="font-medium">
                                  {booking.customer.firstName} {booking.customer.lastName}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {booking.serviceType === 'cabelo'
                                    ? 'Cabelo'
                                    : booking.serviceType === 'barba'
                                    ? 'Barba'
                                    : 'Cabelo + Barba'}
                                </p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">Livre</span>
                            )}
                          </div>
                          {booking && (
                            <div className="flex gap-2">
                              <Badge
                                variant={
                                  booking.status === 'confirmed'
                                    ? 'default'
                                    : booking.status === 'cancelled'
                                    ? 'destructive'
                                    : 'secondary'
                                }
                              >
                                {booking.status}
                              </Badge>
                              {booking.whatsappStatus === 'sent' && (
                                <Badge variant="outline">WhatsApp ✓</Badge>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalhes da Reserva</DialogTitle>
            <DialogDescription>
              {selectedBooking &&
                `${selectedBooking.customer.firstName} ${selectedBooking.customer.lastName}`}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">Serviço:</span>{' '}
                  {selectedBooking.serviceType === 'cabelo'
                    ? 'Cabelo'
                    : selectedBooking.serviceType === 'barba'
                    ? 'Barba'
                    : 'Cabelo + Barba'}
                </p>
                <p>
                  <span className="font-medium">Horário:</span>{' '}
                  {formatTime(selectedBooking.slotStart)}
                </p>
                <p>
                  <span className="font-medium">WhatsApp:</span>{' '}
                  {selectedBooking.customer.whatsappE164}
                </p>
                <p>
                  <span className="font-medium">Status:</span>{' '}
                  <Badge>{selectedBooking.status}</Badge>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleSendWhatsApp(selectedBooking)}
                  disabled={markWhatsappSentMutation.isPending}
                >
                  Enviar WhatsApp
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirm('Tem certeza que deseja cancelar esta reserva?')) {
                      cancelMutation.mutate(selectedBooking.id);
                    }
                  }}
                  disabled={cancelMutation.isPending}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BlockSlotsModal
        open={blockModalOpen}
        onOpenChange={setBlockModalOpen}
        selectedDate={selectedDate}
      />
    </AdminLayout>
  );
}

