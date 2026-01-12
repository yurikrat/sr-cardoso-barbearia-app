import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { BarberSchedule } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { DateTime } from 'luxon';
import { applyPhoneMask } from '@/utils/phone';

interface CreateBookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
  selectedBarber?: string;
  selectedTime?: string;
  onSuccess?: () => void;
}

export function CreateBookingModal({ 
  open, 
  onOpenChange, 
  selectedDate, 
  selectedBarber,
  selectedTime,
  onSuccess 
}: CreateBookingModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Estados do formulário
  const [barberId, setBarberId] = useState<string>('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<string>('08:00');
  const [serviceType, setServiceType] = useState<string>('cabelo');
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [whatsapp, setWhatsapp] = useState<string>('');
  
  // Dados carregados
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [services, setServices] = useState<Array<{ id: string; label: string; priceCents: number }>>([]);
  const [barberSchedule, setBarberSchedule] = useState<BarberSchedule | null>(null);

  // Atualiza estados quando props mudam
  useEffect(() => {
    if (selectedDate) setDate(selectedDate);
    if (selectedBarber) setBarberId(selectedBarber);
    if (selectedTime) setTime(selectedTime);
  }, [selectedDate, selectedBarber, selectedTime, open]);

  // Carrega barbeiros e serviços
  useEffect(() => {
    if (!open) return;
    
    void (async () => {
      try {
        const [barbersRes, servicesRes] = await Promise.all([
          api.admin.listBarbers(),
          api.services(),
        ]);
        
        const sortedBarbers = [...(barbersRes.items ?? [])].sort((a, b) => {
          if (a.id === 'sr-cardoso') return -1;
          if (b.id === 'sr-cardoso') return 1;
          return a.name.localeCompare(b.name, 'pt-BR');
        });
        
        setBarbers(sortedBarbers);
        setServices(servicesRes.items ?? []);
        
        if (!barberId && sortedBarbers.length > 0) {
          const defaultBarber = sortedBarbers.find(b => b.id === 'sr-cardoso')?.id ?? sortedBarbers[0]?.id;
          setBarberId(defaultBarber || '');
        }
      } catch (err) {
        console.error('Error loading data:', err);
      }
    })();
  }, [open]);

  // Carrega horário do barbeiro selecionado
  useEffect(() => {
    if (!barberId || !open) return;
    
    void (async () => {
      try {
        const barberData = await api.admin.getBarber(barberId);
        setBarberSchedule(barberData.schedule || null);
      } catch (err: unknown) {
        console.error('Error loading barber schedule:', err);
        setBarberSchedule(null);
      }
    })();
  }, [barberId, open]);

  // Gera slots de horário baseado na agenda do barbeiro
  const timeSlots = useMemo(() => {
    if (!barberSchedule || !date) {
      // Fallback: 08:00-18:30
      return Array.from({ length: 22 }, (_, i) => {
        const hour = 8 + Math.floor(i / 2);
        const minute = (i % 2) * 30;
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      });
    }

    const dt = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' });
    const dayKey = dt.weekday === 7 ? '0' : dt.weekday.toString();
    const dayConfig = barberSchedule[dayKey];

    if (!dayConfig || !dayConfig.active) {
      return [];
    }

    const [startH, startM] = dayConfig.start.split(':').map(Number);
    const [endH, endM] = dayConfig.end.split(':').map(Number);
    
    const slots: string[] = [];
    let h = startH;
    let m = startM;
    
    while (h < endH || (h === endH && m < endM)) {
      const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      
      // Verifica se está em período de pausa
      const isInBreak =
        dayConfig.breaks?.some((brk) => {
          return timeStr >= brk.start && timeStr < brk.end;
        }) ?? false;
      
      if (!isInBreak) {
        slots.push(timeStr);
      }
      
      m += 30;
      if (m >= 60) {
        h++;
        m = 0;
      }
    }
    
    return slots;
  }, [barberSchedule, date]);

  const createBookingMutation = useMutation({
    mutationFn: async (data: {
      barberId: string;
      serviceType: string;
      slotStart: string;
      customer: {
        firstName: string;
        lastName: string;
        whatsapp: string;
      };
    }) => {
      return api.admin.createBooking(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      resetForm();
      onOpenChange(false);
      onSuccess?.();
      toast({
        title: 'Sucesso',
        description: 'Agendamento criado com sucesso.',
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao criar agendamento.';
      toast({
        title: 'Erro',
        description: message,
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setWhatsapp('');
    setServiceType('cabelo');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!firstName.trim() || !lastName.trim() || !whatsapp.trim()) {
      toast({
        title: 'Erro',
        description: 'Preencha todos os campos do cliente.',
        variant: 'destructive',
      });
      return;
    }

    const [hour, minute] = time.split(':').map(Number);
    const slotStart = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' })
      .set({ hour, minute, second: 0, millisecond: 0 });

    createBookingMutation.mutate({
      barberId,
      serviceType,
      slotStart: slotStart.toISO() || '',
      customer: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        whatsapp: whatsapp.replace(/\D/g, ''),
      },
    });
  };

  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyPhoneMask(e.target.value);
    setWhatsapp(masked);
  };

  const isDayOff = useMemo(() => {
    if (!barberSchedule || !date) return false;
    const dt = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' });
    const dayKey = dt.weekday === 7 ? '0' : dt.weekday.toString();
    const dayConfig = barberSchedule[dayKey];
    return !dayConfig || !dayConfig.active;
  }, [barberSchedule, date]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Agendamento</DialogTitle>
          <DialogDescription>
            Crie um agendamento manualmente para um cliente
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="barber">Barbeiro</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger id="barber" className="mt-1">
                <SelectValue placeholder="Selecione o barbeiro" />
              </SelectTrigger>
              <SelectContent>
                {barbers.map((barber) => (
                  <SelectItem key={barber.id} value={barber.id}>
                    {barber.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                value={DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' }).toFormat('yyyy-MM-dd')}
                onChange={(e) => {
                  const newDate = DateTime.fromISO(e.target.value, { zone: 'America/Sao_Paulo' }).toJSDate();
                  setDate(newDate);
                }}
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="time">Horário</Label>
              <Select value={time} onValueChange={setTime} disabled={isDayOff}>
                <SelectTrigger id="time" className="mt-1">
                  <SelectValue placeholder={isDayOff ? 'Dia fechado' : 'Selecione'} />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isDayOff && (
                <p className="text-xs text-destructive mt-1">Barbeiro não atende neste dia</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="service">Serviço</Label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger id="service" className="mt-1">
                <SelectValue placeholder="Selecione o serviço" />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.label} - R$ {(service.priceCents / 100).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <h4 className="text-sm font-medium text-muted-foreground">Dados do Cliente</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">Nome</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="João"
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="lastName">Sobrenome</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Silva"
                  className="mt-1"
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <Input
                id="whatsapp"
                value={whatsapp}
                onChange={handleWhatsappChange}
                placeholder="(11) 99999-9999"
                className="mt-1"
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createBookingMutation.isPending || isDayOff}>
              {createBookingMutation.isPending ? 'Criando...' : 'Criar Agendamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
