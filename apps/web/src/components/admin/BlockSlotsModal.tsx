import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminBlockSlotsFn } from '@/lib/firebase';
import { useToast } from '@/components/ui/use-toast';
import { DateTime } from 'luxon';
import { BARBERS } from '@/utils/constants';

const TIME_SLOTS = Array.from({ length: 22 }, (_, i) => {
  const hour = 8 + Math.floor(i / 2);
  const minute = (i % 2) * 30;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}).filter((time) => {
  const [h, m] = time.split(':').map(Number);
  return h < 19 || (h === 18 && m <= 30);
});

interface BlockSlotsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
}

export function BlockSlotsModal({ open, onOpenChange, selectedDate }: BlockSlotsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [barberId, setBarberId] = useState<string>('sr-cardoso');
  const [date, setDate] = useState<Date>(selectedDate || new Date());
  const [startTime, setStartTime] = useState<string>('08:00');
  const [endTime, setEndTime] = useState<string>('09:00');
  const [reason, setReason] = useState<string>('');

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
    onError: (error: any) => {
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao bloquear horários.',
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear Horários</DialogTitle>
          <DialogDescription>
            Selecione o intervalo de horários que deseja bloquear
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="barber">Barbeiro</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger id="barber" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BARBERS.map((barber) => (
                  <SelectItem key={barber.id} value={barber.id}>
                    {barber.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startTime">Horário Inicial</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger id="startTime" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="endTime">Horário Final</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger id="endTime" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="reason">Motivo (opcional)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Almoço, Folga, etc."
              className="mt-1"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={blockMutation.isPending}>
              {blockMutation.isPending ? 'Bloqueando...' : 'Bloquear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

