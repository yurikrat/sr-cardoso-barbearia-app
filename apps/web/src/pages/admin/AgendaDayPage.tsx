import { useMemo, useState, useEffect } from 'react';
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
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/components/ui/use-toast';
import { adminCancelBookingFn, adminMarkWhatsappSentFn } from '@/lib/firebase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateBookingConfirmationMessage, generateWhatsAppDeepLink } from '@/utils/whatsapp';
import { Calendar as CalendarIcon } from 'lucide-react';
import { debugLog } from '@/utils/debugLog';
import { useSearchParams } from 'react-router-dom';
import { SERVICE_LABELS } from '@/utils/constants';

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

function slotIdToTimeKey(slotId: string): string | null {
  const m = slotId.match(/^(?:\d{8})_(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

const SLOT_MINUTES = 30;
const GRID_ROW_PX = 44;

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
  const [blockedTimes, setBlockedTimes] = useState<Set<string>>(new Set());
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  const dateKey = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).toFormat('yyyy-MM-dd');
  const selectedDateLabel = useMemo(() => {
    return DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' })
      .setLocale('pt-BR')
      .toFormat("cccc, dd 'de' LLLL 'de' yyyy");
  }, [selectedDate]);

  const dayStart = useMemo(() => {
    const [h, m] = TIME_SLOTS[0].split(':').map(Number);
    return DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  }, [selectedDate]);

  const dayEnd = useMemo(() => {
    const [h, m] = TIME_SLOTS[TIME_SLOTS.length - 1].split(':').map(Number);
    return DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' })
      .set({ hour: h, minute: m, second: 0, millisecond: 0 })
      .plus({ minutes: SLOT_MINUTES });
  }, [selectedDate]);

  const nowLineTopPx = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    const sameDay = now.toFormat('yyyy-MM-dd') === dateKey;
    if (!sameDay) return null;
    if (now < dayStart || now > dayEnd) return null;
    const minutesFromStart = Math.max(0, now.diff(dayStart, 'minutes').minutes);
    return (minutesFromStart / SLOT_MINUTES) * GRID_ROW_PX;
  }, [dateKey, dayStart, dayEnd]);

  const events = useMemo(() => {
    const bookingItems = Object.values(bookings)
      .filter((b) => Boolean(b?.id))
      .map((b) => {
        const start = DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' });
        const minutesFromStart = start.diff(dayStart, 'minutes').minutes;
        const topPx = (minutesFromStart / SLOT_MINUTES) * GRID_ROW_PX;
        const heightPx = GRID_ROW_PX; // 30min por slot
        return { kind: 'booking' as const, booking: b, topPx, heightPx };
      })
      .filter((e) => e.topPx >= 0 && e.topPx < TIME_SLOTS.length * GRID_ROW_PX)
      .sort((a, b) => a.topPx - b.topPx);

    const blockedItems = Array.from(blockedTimes)
      .map((timeKey) => {
        const [h, m] = timeKey.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        const start = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).set({
          hour: h,
          minute: m,
          second: 0,
          millisecond: 0,
        });
        const minutesFromStart = start.diff(dayStart, 'minutes').minutes;
        const topPx = (minutesFromStart / SLOT_MINUTES) * GRID_ROW_PX;
        const heightPx = GRID_ROW_PX;
        return { kind: 'block' as const, timeKey, topPx, heightPx };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .filter((e) => e.topPx >= 0 && e.topPx < TIME_SLOTS.length * GRID_ROW_PX)
      .sort((a, b) => a.topPx - b.topPx);

    return [...blockedItems, ...bookingItems].sort((a, b) => a.topPx - b.topPx);

  }, [bookings, blockedTimes, dayStart, selectedDate]);

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
      const [{ items }, availability] = await Promise.all([
        api.admin.listBookings(selectedBarber, dateKey),
        api.availability(selectedBarber, dateKey),
      ]);

      const nextBlocked = new Set<string>();
      (availability?.blockedSlotIds ?? []).forEach((slotId) => {
        const tk = typeof slotId === 'string' ? slotIdToTimeKey(slotId) : null;
        if (tk) nextBlocked.add(tk);
      });

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
      setBlockedTimes(nextBlocked);
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
      booking.serviceType,
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
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <h2 className="text-2xl font-serif font-bold">Agenda do Dia</h2>
                <div className="text-sm text-muted-foreground capitalize">{selectedDateLabel}</div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const prev = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).minus({ days: 1 }).toJSDate();
                    setSelectedDate(prev);
                  }}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const today = DateTime.now().setZone('America/Sao_Paulo').startOf('day').toJSDate();
                    setSelectedDate(today);
                  }}
                >
                  Hoje
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const next = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).plus({ days: 1 }).toJSDate();
                    setSelectedDate(next);
                  }}
                >
                  Próximo
                </Button>
              </div>
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
                        <div className="border-t border-border/60">
                          <div className="max-h-[70vh] overflow-y-auto">
                            <div className="grid grid-cols-[80px_1fr]">
                              {/* Coluna de horários */}
                              <div className="bg-background/40">
                                {TIME_SLOTS.map((time) => {
                                  const [h, m] = time.split(':').map(Number);
                                  const showLabel = m === 0;
                                  return (
                                    <div
                                      key={time}
                                      className="border-b border-border/60 pr-3"
                                      style={{ height: GRID_ROW_PX }}
                                    >
                                      <div className="h-full flex items-start justify-end pt-1">
                                        {showLabel ? (
                                          <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                                            {h.toString().padStart(2, '0')}:00
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Grade + eventos */}
                              <div className="relative">
                                {/* linhas da grade */}
                                <div aria-hidden className="absolute inset-0">
                                  {TIME_SLOTS.map((time) => {
                                    const [, m] = time.split(':').map(Number);
                                    const isHour = m === 0;
                                    return (
                                      <div
                                        key={time}
                                        className={
                                          'border-b ' +
                                          (isHour ? 'border-border/70' : 'border-border/40')
                                        }
                                        style={{ height: GRID_ROW_PX }}
                                      />
                                    );
                                  })}
                                </div>

                                {/* indicador de horário atual */}
                                {nowLineTopPx != null ? (
                                  <div
                                    className="absolute left-0 right-0"
                                    style={{ top: nowLineTopPx }}
                                    aria-label="Horário atual"
                                  >
                                    <div className="relative">
                                      <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-destructive" />
                                      <div className="h-px bg-destructive" />
                                    </div>
                                  </div>
                                ) : null}

                                {/* eventos */}
                                <div
                                  className="relative"
                                  style={{ height: TIME_SLOTS.length * GRID_ROW_PX }}
                                >
                                  {events.map((ev) => {
                                    if (ev.kind === 'block') {
                                      return (
                                        <div
                                          key={`block:${ev.timeKey}`}
                                          className="absolute left-2 right-2 rounded-md border px-2 py-1.5 text-left bg-muted/40 border-border/60"
                                          style={{ top: ev.topPx, height: ev.heightPx - 6 }}
                                          aria-label={`Bloqueado ${ev.timeKey}`}
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="truncate text-sm font-medium">Bloqueado</div>
                                              <div className="truncate text-xs text-muted-foreground">Horário fechado</div>
                                            </div>
                                            <Badge variant="outline" className="shrink-0">
                                              Fechado
                                            </Badge>
                                          </div>
                                        </div>
                                      );
                                    }

                                    const booking = ev.booking;
                                    const isBad = booking.status === 'no_show' || booking.status === 'cancelled';
                                    const containerClass =
                                      'absolute left-2 right-2 rounded-md border px-2 py-1.5 text-left shadow-sm ' +
                                      (isBad
                                        ? 'bg-destructive/10 border-destructive/20'
                                        : 'bg-primary/10 border-primary/20');

                                    return (
                                      <button
                                        key={booking.id}
                                        type="button"
                                        className={containerClass}
                                        style={{ top: ev.topPx, height: ev.heightPx - 6 }}
                                        onClick={() => setSelectedBooking(booking)}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <div className="truncate text-sm font-medium">
                                              {booking.customer.firstName} {booking.customer.lastName}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                              {SERVICE_LABELS[booking.serviceType] || booking.serviceType}
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2">
                                            <Badge
                                              variant={
                                                booking.status === 'completed' || booking.status === 'confirmed'
                                                  ? 'default'
                                                  : booking.status === 'no_show' || booking.status === 'cancelled'
                                                  ? 'destructive'
                                                  : 'secondary'
                                              }
                                              className="shrink-0"
                                            >
                                              {formatBookingStatusPtBr(booking.status)}
                                            </Badge>
                                            {booking.whatsappStatus === 'sent' ? (
                                              <Badge variant="outline" className="shrink-0">
                                                WhatsApp ✓
                                              </Badge>
                                            ) : null}
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
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
                  {SERVICE_LABELS[selectedBooking.serviceType] || selectedBooking.serviceType}
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
                  disabled={
                    setStatusMutation.isPending ||
                    selectedBooking.status === 'completed' ||
                    selectedBooking.status === 'cancelled'
                  }
                >
                  Concluir
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatusMutation.mutate({ bookingId: selectedBooking.id, status: 'no_show' })}
                  disabled={
                    setStatusMutation.isPending ||
                    selectedBooking.status === 'no_show' ||
                    selectedBooking.status === 'cancelled'
                  }
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
        onOpenChange={(open) => {
          setBlockModalOpen(open);
          if (!open) loadBookings();
        }}
        selectedDate={selectedDate}
      />
    </AdminLayout>
  );
}

