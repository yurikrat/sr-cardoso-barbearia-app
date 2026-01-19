import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { DateTime } from 'luxon';
import { ADMIN_TIME_SLOTS } from '@/utils/constants';

interface RescheduleBookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: any; // Type 'Booking' from shared if possible
  onSuccess?: () => void;
}

export function RescheduleBookingModal({ 
  open, 
  onOpenChange, 
  booking,
  onSuccess 
}: RescheduleBookingModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  // Estados do formulário
  const [dateStr, setDateStr] = useState<string>('');
  const [time, setTime] = useState<string>('');
  
  // Sincroniza dados do agendamento quando abre
  useEffect(() => {
    if (open && booking) {
      const dt = DateTime.fromJSDate(booking.slotStart, { zone: 'America/Sao_Paulo' });
      setDateStr(dt.toFormat('yyyy-MM-dd'));
      setTime(dt.toFormat('HH:mm'));
    }
  }, [open, booking]);

  const handleReschedule = async () => {
    if (!booking || !dateStr || !time) return;

    setLoading(true);
    try {
      // Criar o novo timestamp de início
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hour, minute] = time.split(':').map(Number);
      
      const newSlotStart = DateTime.fromObject({
        year, month, day, hour, minute
      }, { zone: 'America/Sao_Paulo' }).toISO();

      if (!newSlotStart) throw new Error('Data ou hora inválida');

      await api.admin.rescheduleBooking(booking.id, newSlotStart);

      toast({
        title: 'Reagendado com sucesso',
        description: `Novo horário: ${DateTime.fromISO(newSlotStart).setLocale('pt-BR').toFormat("dd/MM 'às' HH:mm")}`,
      });

      if (onSuccess) onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error rescheduling:', err);
      const msg = err.message || 'Erro ao reagendar.';
      toast({
        title: 'Erro ao reagendar',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!booking) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Reagendar Atendimento</DialogTitle>
          <DialogDescription>
            Ajuste o horário de {booking.customer.firstName}. O histórico será preservado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="date">Nova Data</Label>
            <input
              id="date"
              type="date"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="time">Novo Horário</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger id="time">
                <SelectValue placeholder="Selecione o horário" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {ADMIN_TIME_SLOTS.map((slot) => (
                  <SelectItem key={slot} value={slot}>
                    {slot}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleReschedule} disabled={loading || !dateStr || !time}>
            {loading ? 'Processando...' : 'Confirmar Alteração'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
