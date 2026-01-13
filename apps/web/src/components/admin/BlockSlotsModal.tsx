import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminBlockSlotsFn } from '@/lib/api-compat';
import { useToast } from '@/components/ui/use-toast';
import { DateTime } from 'luxon';
import { ADMIN_TIME_SLOTS, ADMIN_END_TIME_SLOTS } from '@/utils/constants';

// Usa slots da janela ampliada do admin (07:30 até 20:30)
const START_TIME_SLOTS = ADMIN_TIME_SLOTS;
const END_TIME_SLOTS = ADMIN_END_TIME_SLOTS;

interface BlockSlotsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
  selectedBarberId?: string;
  barbers?: Array<{ id: string; name: string }>;
  disableBarberSelect?: boolean;
}

export function BlockSlotsModal({ open, onOpenChange, selectedDate, selectedBarberId, barbers, disableBarberSelect }: BlockSlotsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resolvedBarbers = useMemo(() => {
    const items = barbers ?? [];
    if (disableBarberSelect && selectedBarberId) {
      const found = items.find((b) => b.id === selectedBarberId);
      return found ? [found] : [{ id: selectedBarberId, name: selectedBarberId }];
    }
    return items;
  }, [barbers, disableBarberSelect, selectedBarberId]);

  const [barberId, setBarberId] = useState<string>(selectedBarberId || '');
  const [date, setDate] = useState<Date>(selectedDate || new Date());
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('10:00');
  const [reason, setReason] = useState<string>('');

  // Filtra END_TIME_SLOTS para mostrar apenas horários maiores que startTime
  const availableEndTimes = useMemo(() => {
    return END_TIME_SLOTS.filter((time) => time > startTime);
  }, [startTime]);

  // Ajusta endTime quando startTime mudar e endTime ficar inválido
  useEffect(() => {
    if (endTime <= startTime) {
      // Seleciona o próximo horário disponível (startTime + 30min)
      const nextSlot = availableEndTimes[0];
      if (nextSlot) {
        setEndTime(nextSlot);
      }
    }
  }, [startTime, endTime, availableEndTimes]);
  useEffect(() => {
    if (!open) return;
    if (selectedDate) setDate(selectedDate);
    if (selectedBarberId) setBarberId(selectedBarberId);
  }, [open, selectedDate, selectedBarberId]);

  useEffect(() => {
    if (!open) return;
    if (disableBarberSelect && selectedBarberId) {
      setBarberId(selectedBarberId);
      return;
    }
    if (barberId) return;
    const fallback = resolvedBarbers.find((b) => b.id === 'sr-cardoso')?.id ?? resolvedBarbers[0]?.id ?? '';
    if (fallback) setBarberId(fallback);
  }, [open, disableBarberSelect, selectedBarberId, barberId, resolvedBarbers]);

  const blockMutation = useMutation({
    mutationFn: async (data: {
      barberId: string;
      startTime: string;
      endTime: string;
      reason: string;
    }) => {
      const result = await adminBlockSlotsFn(data);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      onOpenChange(false);
      setReason('');
      toast({
        title: 'Sucesso',
        description: 'Horários bloqueados com sucesso.',
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : null;
      toast({
        title: 'Erro',
        description: message || 'Erro ao bloquear horários.',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    
    const startDateTime = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' })
      .set({ hour: startHour, minute: startMin, second: 0, millisecond: 0 });
    const endDateTime = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' })
      .set({ hour: endHour, minute: endMin, second: 0, millisecond: 0 });

    blockMutation.mutate({
      barberId,
      startTime: startDateTime.toISO() || '',
      endTime: endDateTime.toISO() || '',
      reason: reason || 'Horário bloqueado',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bloquear Horários</DialogTitle>
          <DialogDescription>
            Selecione o intervalo de horários que deseja bloquear
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="barber" className="text-sm font-medium">Barbeiro</Label>
            <Select value={barberId} onValueChange={setBarberId} disabled={!!disableBarberSelect}>
              <SelectTrigger id="barber" className="mt-1.5 h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {resolvedBarbers.map((barber) => (
                  <SelectItem key={barber.id} value={barber.id} className="py-3 text-base">
                    {barber.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="date" className="text-sm font-medium">Data</Label>
            <Input
              id="date"
              type="date"
              value={DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' }).toFormat('yyyy-MM-dd')}
              onChange={(e) => {
                const newDate = DateTime.fromISO(e.target.value, { zone: 'America/Sao_Paulo' }).toJSDate();
                setDate(newDate);
              }}
              className="mt-1.5 h-12 text-base"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="startTime" className="text-sm font-medium">Horário Inicial</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger id="startTime" className="mt-1.5 h-12 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {START_TIME_SLOTS.map((time) => (
                    <SelectItem key={time} value={time} className="py-3 text-base">
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="endTime" className="text-sm font-medium">Horário Final</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger id="endTime" className="mt-1.5 h-12 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {availableEndTimes.map((time) => (
                    <SelectItem key={time} value={time} className="py-3 text-base">
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="reason" className="text-sm font-medium">Motivo (opcional)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Almoço, Folga, etc."
              className="mt-1.5 h-12 text-base"
            />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="h-12 flex-1 text-base sm:flex-none"
            >
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={blockMutation.isPending}
              className="h-12 flex-1 text-base sm:flex-none"
            >
              {blockMutation.isPending ? 'Bloqueando...' : 'Bloquear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

