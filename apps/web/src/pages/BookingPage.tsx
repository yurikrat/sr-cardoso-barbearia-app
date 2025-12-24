import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingState } from '@/contexts/BookingContext';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/Stepper';
import { ServiceCard } from '@/components/ServiceCard';
import { BarberCard } from '@/components/BarberCard';
import { StickyFooter } from '@/components/StickyFooter';
import { Calendar } from '@/components/ui/calendar';
import { SlotPill } from '@/components/SlotPill';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useToast } from '@/components/ui/use-toast';
import { createBookingFn } from '@/lib/firebase';
import { applyPhoneMask, normalizeToE164 } from '@/utils/phone';
import { generateDaySlots, isSlotPast } from '@/utils/slots';
import { formatDate, formatTime, isToday } from '@/utils/dates';
import { isValidName, isValidBrazilianPhone } from '@/utils/validation';
import { debugLog } from '@/utils/debugLog';
import { DateTime } from 'luxon';
import { api } from '@/lib/api';
import type { ServiceType } from '@sr-cardoso/shared';
import { BARBERS } from '@/utils/constants';

export default function BookingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const bookingState = useBookingState();
  const { clearBooking } = bookingState;
  const todayStart = DateTime.now()
    .setZone('America/Sao_Paulo')
    .startOf('day')
    .toJSDate();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [availableSlots, setAvailableSlots] = useState<DateTime[]>([]);
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    firstName: '',
    lastName: '',
    whatsapp: '',
  });

  const didInitRef = useRef(false);

  useLayoutEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    clearBooking();
    setStep(1);
    setSelectedDate(undefined);
    setAvailableSlots([]);
    setBookedSlots(new Set());
    setBlockedSlots(new Set());
    setCustomerForm({ firstName: '', lastName: '', whatsapp: '' });
  }, [clearBooking]);

  // Carregar slots quando barbeiro e data são selecionados
  const loadAvailableSlots = useCallback(async () => {
    if (!bookingState.barberId || !selectedDate) return;

    setLoadingSlots(true);
    try {
      const date = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' });
      const dateKey = date.toFormat('yyyy-MM-dd');
      
      // Gerar todos os slots do dia
      const allSlots = generateDaySlots(selectedDate);
      setAvailableSlots(allSlots);

      const booked = new Set<string>();
      const blocked = new Set<string>();
      const availability = await api.availability(bookingState.barberId, dateKey);
      availability.bookedSlotIds.forEach((id) => booked.add(id));
      availability.blockedSlotIds.forEach((id) => blocked.add(id));

      // #region agent log
      debugLog({
        sessionId: 'debug-session',
        runId: 'run3',
        hypothesisId: 'H2',
        location: 'apps/web/src/pages/BookingPage.tsx:loadAvailableSlots:success',
        message: 'slots loaded',
        data: {
          barberId: bookingState.barberId,
          dateKey,
          totalSlots: allSlots.length,
          firestoreDocs: availability.bookedSlotIds.length + availability.blockedSlotIds.length,
          bookedCount: booked.size,
          blockedCount: blocked.size,
        },
        timestamp: Date.now(),
      });
      // #endregion

      setBookedSlots(booked);
      setBlockedSlots(blocked);
    } catch (error: unknown) {
      console.error('Error loading slots:', error);
      const err = error as { name?: unknown; code?: unknown; message?: unknown };
      // #region agent log
      debugLog({
        sessionId: 'debug-session',
        runId: 'run3',
        hypothesisId: 'H2',
        location: 'apps/web/src/pages/BookingPage.tsx:loadAvailableSlots:catch',
        message: 'slots load failed',
        data: {
          barberId: bookingState.barberId,
          errorName: typeof err?.name === 'string' ? err.name : null,
          errorCode: typeof err?.code === 'string' ? err.code : null,
          errorMessage: typeof err?.message === 'string' ? err.message : null,
        },
        timestamp: Date.now(),
      });
      // #endregion
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os horários disponíveis.',
        variant: 'destructive',
      });
    } finally {
      setLoadingSlots(false);
    }
  }, [bookingState.barberId, selectedDate, toast]);

  useEffect(() => {
    if (bookingState.barberId && selectedDate) {
      loadAvailableSlots();
    }
  }, [bookingState.barberId, selectedDate, loadAvailableSlots]);
  type CreateBookingResponse = { success: boolean; bookingId: string; cancelCode?: string | null; message?: string };

  const createBookingMutation = useMutation({
    mutationFn: async (data: {
      barberId: string;
      serviceType: ServiceType;
      slotStart: string;
      customer: {
        firstName: string;
        lastName: string;
        whatsapp: string;
      };
    }) => {
      const result = await createBookingFn(data);
      return result.data as CreateBookingResponse;
    },
    onSuccess: (data) => {
      bookingState.setCancelCode(data.cancelCode ?? null);
      navigate(`/sucesso?bookingId=${data.bookingId}`);
    },
    onError: (error: unknown) => {
      const err = error as { code?: unknown; message?: unknown };
      // #region agent log
      debugLog({
        sessionId: 'debug-session',
        runId: 'run3',
        hypothesisId: 'H3',
        location: 'apps/web/src/pages/BookingPage.tsx:createBooking:onError',
        message: 'createBooking failed',
        data: {
          errorCode: typeof err?.code === 'string' ? err.code : null,
          errorMessage: typeof err?.message === 'string' ? err.message : null,
        },
        timestamp: Date.now(),
      });
      // #endregion
      const message =
        (typeof err?.message === 'string' && err.message) || 'Erro ao criar agendamento. Tente novamente.';
      toast({
        title: 'Erro',
        description: message,
        variant: 'destructive',
      });
    },
  });

  const handleServiceSelect = (service: ServiceType) => {
    bookingState.setBarberId(null);
    bookingState.setSelectedDate(null);
    bookingState.setSelectedSlot(null);
    setSelectedDate(undefined);
    setAvailableSlots([]);
    setBookedSlots(new Set());
    setBlockedSlots(new Set());
    bookingState.setServiceType(service);
    setStep(2);
  };

  const handleBarberSelect = (barberId: string) => {
    bookingState.setSelectedDate(null);
    bookingState.setSelectedSlot(null);
    setSelectedDate(undefined);
    setAvailableSlots([]);
    setBookedSlots(new Set());
    setBlockedSlots(new Set());
    bookingState.setBarberId(barberId);
    setStep(3);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    bookingState.setSelectedSlot(null);
    setSelectedDate(date);
    bookingState.setSelectedDate(date);
    setStep(4);
  };

  const handleSlotSelect = (slot: DateTime) => {
    bookingState.setSelectedSlot(slot);
    setStep(5);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!bookingState.serviceType || !bookingState.barberId || !bookingState.selectedDate || !bookingState.selectedSlot) {
      toast({
        title: 'Erro',
        description: 'Por favor, complete todos os passos.',
        variant: 'destructive',
      });
      return;
    }

    // Validações
    if (!isValidName(customerForm.firstName)) {
      toast({
        title: 'Erro',
        description: 'Por favor, insira um nome válido (mínimo 2 caracteres).',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidName(customerForm.lastName)) {
      toast({
        title: 'Erro',
        description: 'Por favor, insira um sobrenome válido (mínimo 2 caracteres).',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidBrazilianPhone(customerForm.whatsapp)) {
      toast({
        title: 'Erro',
        description: 'Por favor, insira um número de WhatsApp válido.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const whatsappE164 = normalizeToE164(customerForm.whatsapp);
      
      if (!whatsappE164) {
        toast({
          title: 'Erro',
          description: 'Não foi possível processar o número de WhatsApp.',
          variant: 'destructive',
        });
        return;
      }
      // #region agent log
      debugLog({
        sessionId: 'debug-session',
        runId: 'run3',
        hypothesisId: 'H3',
        location: 'apps/web/src/pages/BookingPage.tsx:handleSubmit:beforeMutation',
        message: 'about to call createBooking',
        data: {
          barberId: bookingState.barberId,
          serviceType: bookingState.serviceType,
          hasSlot: !!bookingState.selectedSlot,
          slotIsoLen: bookingState.selectedSlot?.toISO()?.length ?? null,
          whatsappE164Len: whatsappE164.length,
        },
        timestamp: Date.now(),
      });
      // #endregion
      
      createBookingMutation.mutate({
        barberId: bookingState.barberId,
        serviceType: bookingState.serviceType,
        slotStart: bookingState.selectedSlot.toISO() || '',
        customer: {
          firstName: customerForm.firstName.trim(),
          lastName: customerForm.lastName.trim(),
          whatsapp: whatsappE164,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({
        title: 'Erro',
        description: message || 'Erro ao processar dados.',
        variant: 'destructive',
      });
    }
  };

  const getSlotStatus = (slot: DateTime): 'available' | 'booked' | 'blocked' | 'past' => {
    const slotId = slot.toFormat('yyyyMMdd_HHmm');
    
    if (isSlotPast(slot) && isToday(selectedDate!)) {
      return 'past';
    }
    if (bookedSlots.has(slotId)) {
      return 'booked';
    }
    if (blockedSlots.has(slotId)) {
      return 'blocked';
    }
    return 'available';
  };

  return (
    <div className="min-h-[100dvh] bg-background p-4 safe-top-p4 pb-[calc(6rem+env(safe-area-inset-bottom))] overflow-x-hidden">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center">
          <Link to="/" className="inline-block" aria-label="Ir para a página inicial">
            <img src="/logo.png" alt="Sr. Cardoso Barbearia" className="mx-auto w-40 h-auto" />
          </Link>
          <h1 className="text-2xl font-serif font-bold">Agendar</h1>
          <Stepper currentStep={step} totalSteps={6} />
        </div>

        {/* Step 1: Serviço */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Escolha o serviço</h2>
            <div className="space-y-3">
              <ServiceCard
                service="cabelo"
                label="Cabelo"
                selected={bookingState.serviceType === 'cabelo'}
                onClick={() => handleServiceSelect('cabelo')}
              />
              <ServiceCard
                service="barba"
                label="Barba"
                selected={bookingState.serviceType === 'barba'}
                onClick={() => handleServiceSelect('barba')}
              />
              <ServiceCard
                service="cabelo_barba"
                label="Cabelo + Barba"
                selected={bookingState.serviceType === 'cabelo_barba'}
                onClick={() => handleServiceSelect('cabelo_barba')}
              />
            </div>
          </div>
        )}

        {/* Step 2: Barbeiro */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Escolha o barbeiro</h2>
            <div className="space-y-3">
              {BARBERS.map((barber) => (
                <BarberCard
                  key={barber.id}
                  id={barber.id}
                  name={barber.name}
                  selected={bookingState.barberId === barber.id}
                  onClick={() => handleBarberSelect(barber.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Data */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Escolha a data</h2>
              <p className="text-sm text-muted-foreground">
                {selectedDate ? `Selecionada: ${formatDate(selectedDate)}` : 'Selecione uma data disponível'}
              </p>
            </div>
            <Calendar
              mode="single"
              required
              selected={selectedDate}
              onSelect={handleDateSelect}
              onDayClick={(day, modifiers) => {
                if (modifiers?.disabled) return;
                handleDateSelect(day);
              }}
              fromMonth={todayStart}
              showOutsideDays={false}
              disabled={[{ before: todayStart }, { dayOfWeek: [0] }]}
              className="rounded-xl border border-primary/10 bg-card/50 backdrop-blur-sm"
              classNames={{
                caption_label: 'text-base font-serif tracking-wide',
                button_previous: 'absolute left-1 h-9 w-9 bg-transparent p-0 opacity-70 hover:opacity-100 text-primary',
                button_next: 'absolute right-1 h-9 w-9 bg-transparent p-0 opacity-70 hover:opacity-100 text-primary',
                weekday:
                  'text-muted-foreground/80 rounded-md w-11 h-9 flex items-center justify-center font-normal text-[0.75rem] uppercase tracking-wider',
                day: 'h-11 w-11 p-0 text-center text-sm focus-within:relative focus-within:z-20',
                day_button:
                  'h-11 w-11 p-0 flex items-center justify-center font-normal rounded-md transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation',
                selected:
                  '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
                today:
                  '[&>button]:border [&>button]:border-primary/30 [&>button]:text-primary [&>button]:font-semibold [&>button]:bg-transparent',
                disabled: '[&>button]:text-muted-foreground/40 [&>button]:opacity-40',
              }}
            />
            <p className="text-sm text-muted-foreground text-center">
              Domingo: Fechado
            </p>
          </div>
        )}

        {/* Step 4: Horário */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Escolha o horário</h2>
            {loadingSlots ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {availableSlots.map((slot) => {
                  const status = getSlotStatus(slot);
                  const isSelectedSlot = bookingState.selectedSlot?.toMillis() === slot.toMillis();
                  return (
                    <SlotPill
                      key={slot.toISO()}
                      slot={slot}
                      status={status}
                      selected={isSelectedSlot}
                      onClick={() => status === 'available' && handleSlotSelect(slot)}
                      disabled={status !== 'available'}
                    />
                  );
                })}
              </div>
            )}
            {availableSlots.length === 0 && !loadingSlots && (
              <p className="text-center text-muted-foreground py-8">
                Sem horários disponíveis neste dia
              </p>
            )}
          </div>
        )}

        {/* Step 5: Dados do Cliente */}
        {step === 5 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              bookingState.setCustomerData(customerForm);
              setStep(6);
            }}
            className="space-y-4"
          >
            <h2 className="text-lg font-semibold">Seus dados</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="firstName">Nome</Label>
                <Input
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  value={customerForm.firstName}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, firstName: e.target.value })
                  }
                  required
                  minLength={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Sobrenome</Label>
                <Input
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  value={customerForm.lastName}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, lastName: e.target.value })
                  }
                  required
                  minLength={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="whatsapp">WhatsApp</Label>
                <Input
                  id="whatsapp"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={customerForm.whatsapp}
                  onChange={(e) => {
                    const masked = applyPhoneMask(e.target.value);
                    setCustomerForm({ ...customerForm, whatsapp: masked });
                  }}
                  placeholder="Seu WhatsApp"
                  required
                  className="mt-1"
                />
              </div>
            </div>
            <StickyFooter>
              <Button type="submit" className="w-full">
                Continuar
              </Button>
            </StickyFooter>
          </form>
        )}

        {/* Step 6: Revisão */}
        {step === 6 && bookingState.selectedSlot && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Revisão</h2>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">Serviço:</span>{' '}
                {bookingState.serviceType === 'cabelo'
                  ? 'Cabelo'
                  : bookingState.serviceType === 'barba'
                  ? 'Barba'
                  : 'Cabelo + Barba'}
              </p>
              <p>
                <span className="font-medium">Barbeiro:</span>{' '}
                {BARBERS.find((b) => b.id === bookingState.barberId)?.name}
              </p>
              <p>
                <span className="font-medium">Data:</span>{' '}
                {formatDate(bookingState.selectedDate!)}
              </p>
              <p>
                <span className="font-medium">Horário:</span>{' '}
                {formatTime(bookingState.selectedSlot)}
              </p>
              <p>
                <span className="font-medium">Cliente:</span>{' '}
                {customerForm.firstName} {customerForm.lastName}
              </p>
              <p>
                <span className="font-medium">WhatsApp:</span>{' '}
                {customerForm.whatsapp || '—'}
              </p>
            </div>
            <StickyFooter>
              <Button
                onClick={handleSubmit}
                className="w-full"
                disabled={createBookingMutation.isPending}
              >
                {createBookingMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Confirmando...
                  </>
                ) : (
                  'Confirmar agendamento'
                )}
              </Button>
            </StickyFooter>
          </div>
        )}

        {/* Botão Voltar */}
        {step > 1 && step < 5 && (
          <StickyFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (step > 1) setStep(step - 1);
                else navigate('/');
              }}
            >
              Voltar
            </Button>
          </StickyFooter>
        )}
      </div>
    </div>
  );
}
