import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { disabledDays } from '@/utils/calendar';
import { isValidName, isValidBrazilianPhone } from '@/utils/validation';
import { debugLog } from '@/utils/debugLog';
import { DateTime } from 'luxon';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ServiceType } from '@sr-cardoso/shared';
import { BARBERS } from '@/utils/constants';

export default function BookingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const bookingState = useBookingState();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingState.selectedDate || undefined
  );
  const [availableSlots, setAvailableSlots] = useState<DateTime[]>([]);
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    firstName: bookingState.customerData?.firstName || '',
    lastName: bookingState.customerData?.lastName || '',
    whatsapp: bookingState.customerData?.whatsapp || '',
  });

  // Verificar parâmetro de URL para barbeiro
  useEffect(() => {
    const barberParam = searchParams.get('barber');
    if (barberParam && !bookingState.barberId) {
      const barber = BARBERS.find((b) => b.id === barberParam);
      if (barber) {
        bookingState.setBarberId(barber.id);
        setStep(2);
      }
    }
  }, [searchParams, bookingState]);

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

      // Buscar slots ocupados/bloqueados no Firestore
      const slotsRef = collection(
        db,
        `barbers/${bookingState.barberId}/slots`
      );
      const q = query(slotsRef, where('dateKey', '==', dateKey));
      const snapshot = await getDocs(q);

      const booked = new Set<string>();
      const blocked = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data() as { kind?: unknown };
        const slotId = doc.id;
        if (data.kind === 'booking') {
          booked.add(slotId);
        } else if (data.kind === 'block') {
          blocked.add(slotId);
        }
      });

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
          firestoreDocs: snapshot.size,
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
  type CreateBookingResponse = { success: boolean; bookingId: string; message?: string };

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
      bookingState.clearBooking();
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
    bookingState.setServiceType(service);
    setStep(2);
  };

  const handleBarberSelect = (barberId: string) => {
    bookingState.setBarberId(barberId);
    setStep(3);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
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
    <div className="min-h-screen bg-background p-4 safe-top pb-32">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center">
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
            <h2 className="text-lg font-semibold">Escolha a data</h2>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              disabled={disabledDays}
              className="rounded-md border"
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
                  return (
                    <SlotPill
                      key={slot.toISO()}
                      slot={slot}
                      status={status}
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
                  placeholder="(11) 98765-4321"
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
                <span className="font-medium">WhatsApp:</span> {customerForm.whatsapp}
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
