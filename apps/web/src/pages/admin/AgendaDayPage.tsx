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
import { debugLog } from '@/utils/debugLog';
import { useSearchParams } from 'react-router-dom';

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

function formatBookingStatusPtBr(status: string) {
  switch (status) {
    case 'booked':
      return 'Agendado';
    case 'confirmed':
      return 'Confirmado';
    case 'completed':
      return 'Concluído';
    case 'no_show':
      return 'Falta';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status;
  }
}

export default function AgendaDayPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedBarber, setSelectedBarber] = useState<string>('');
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  const dateKey = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).toFormat('yyyy-MM-dd');

  useEffect(() => {
    void (async () => {
      try {
        const { items } = await api.admin.listBarbers();
        const normalized = (items ?? []).map((b) => ({ id: b.id, name: b.name }));
        const sorted = [...normalized].sort((a, b) => {
          const aIsOwner = a.id === 'sr-cardoso';
          const bIsOwner = b.id === 'sr-cardoso';
          if (aIsOwner && !bIsOwner) return -1;
          if (!aIsOwner && bIsOwner) return 1;
          return a.name.localeCompare(b.name, 'pt-BR');
        });
        setBarbers(sorted);

        const qsBarber = searchParams.get('barber');
        const qsDate = searchParams.get('date');

        const nextBarber =
          qsBarber && sorted.some((b) => b.id === qsBarber)
            ? qsBarber
            : sorted.find((b) => b.id === 'sr-cardoso')?.id ?? sorted[0]?.id ?? '';

        if (nextBarber && nextBarber !== selectedBarber) setSelectedBarber(nextBarber);

        if (qsDate) {
          const parsed = DateTime.fromFormat(qsDate, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' });
          if (parsed.isValid) setSelectedDate(parsed.toJSDate());
        }
      } catch {
        setBarbers([]);
        if (!selectedBarber) setSelectedBarber('sr-cardoso');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedBarber) return;
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const setStatusMutation = useMutation({
    mutationFn: async (payload: { bookingId: string; status: 'confirmed' | 'completed' | 'no_show' }) => {
      return api.admin.setBookingStatus(payload.bookingId, payload.status);
    },
    onSuccess: (_data, variables) => {
      loadBookings();
      setSelectedBooking((prev) => (prev ? { ...prev, status: variables.status } : prev));
      toast({
        title: 'Sucesso',
        description:
          variables.status === 'completed'
            ? 'Marcado como concluído.'
            : variables.status === 'no_show'
            ? 'Marcado como falta.'
            : 'Status atualizado.',
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : null;
      toast({
        title: 'Erro',
        description: message || 'Erro ao atualizar status.',
        variant: 'destructive',
      });
    },
  });

  const handleSendWhatsApp = (booking: Booking) => {
    const barberName = barbers.find((b) => b.id === booking.barberId)?.name || 'Barbeiro';
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
      <div className="space-y-4">
        <Tabs value={selectedBarber} onValueChange={setSelectedBarber}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-serif font-bold">Agenda do Dia</h2>
            </div>

            <div className="w-full overflow-x-auto">
              <TabsList className="w-max min-w-full justify-start flex-nowrap">
                {barbers.map((barber) => (
                  <TabsTrigger key={barber.id} value={barber.id} className="whitespace-nowrap">
                    {barber.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
            <div>
              {barbers.map((barber) => (
                <TabsContent key={barber.id} value={barber.id} className="space-y-4">
                  {loading ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner />
                    </div>
                  ) : (
                    <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                      <CardContent className="p-0">
                        <div className="divide-y">
                          {TIME_SLOTS.map((time) => {
                            const booking = bookings[time];
                            const clickable = Boolean(booking);

                            return (
                              <div
                                key={time}
                                className={
                                  'grid grid-cols-[72px_1fr_auto] items-center gap-3 px-3 py-2 ' +
                                  (clickable
                                    ? 'cursor-pointer hover:bg-accent/40 transition-colors'
                                    : 'text-muted-foreground')
                                }
                                onClick={() => booking && setSelectedBooking(booking)}
                                role={clickable ? 'button' : undefined}
                                tabIndex={clickable ? 0 : -1}
                                onKeyDown={(e) => {
                                  if (!booking) return;
                                  if (e.key === 'Enter' || e.key === ' ') setSelectedBooking(booking);
                                }}
                              >
                                <span className="font-mono text-sm font-semibold tabular-nums text-foreground/80">
                                  {time}
                                </span>

                                <div className="min-w-0">
                                  {booking ? (
                                    <div className="min-w-0">
                                      <div className="font-medium truncate">
                                        {booking.customer.firstName} {booking.customer.lastName}
                                      </div>
                                      <div className="text-xs text-muted-foreground truncate">
                                        {booking.serviceType === 'cabelo'
                                          ? 'Cabelo'
                                          : booking.serviceType === 'barba'
                                          ? 'Barba'
                                          : 'Cabelo + Barba'}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-xs">Livre</span>
                                  )}
                                </div>

                                {booking ? (
                                  <div className="flex items-center gap-2 justify-end">
                                    <Badge
                                      variant={
                                        booking.status === 'completed' || booking.status === 'confirmed'
                                          ? 'default'
                                          : booking.status === 'no_show'
                                          ? 'destructive'
                                          : booking.status === 'cancelled'
                                          ? 'destructive'
                                          : 'secondary'
                                      }
                                    >
                                      {formatBookingStatusPtBr(booking.status)}
                                    </Badge>
                                    {booking.whatsappStatus === 'sent' ? (
                                      <Badge variant="outline">WhatsApp ✓</Badge>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              ))}
            </div>

            <aside className="space-y-3">
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardContent className="p-3">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    className="rounded-md border w-full"
                  />
                </CardContent>
              </Card>

              <Button variant="outline" onClick={() => setBlockModalOpen(true)} className="w-full flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                Bloquear Horários
              </Button>
            </aside>
          </div>
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
                  <Badge>{formatBookingStatusPtBr(selectedBooking.status)}</Badge>
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
                  variant="secondary"
                  onClick={() => setStatusMutation.mutate({ bookingId: selectedBooking.id, status: 'completed' })}
                  disabled={setStatusMutation.isPending || selectedBooking.status === 'completed'}
                >
                  Concluir
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatusMutation.mutate({ bookingId: selectedBooking.id, status: 'no_show' })}
                  disabled={setStatusMutation.isPending || selectedBooking.status === 'no_show'}
                >
                  Falta
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

