import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Clock, Plus, Trash2, Save, Loader2 } from 'lucide-react';

const DAYS = [
  { key: '0', label: 'Domingo' },
  { key: '1', label: 'Segunda-feira' },
  { key: '2', label: 'Terça-feira' },
  { key: '3', label: 'Quarta-feira' },
  { key: '4', label: 'Quinta-feira' },
  { key: '5', label: 'Sexta-feira' },
  { key: '6', label: 'Sábado' },
];

type DaySchedule = {
  start: string;
  end: string;
  breaks: Array<{ start: string; end: string }>;
  active: boolean;
};

type Schedule = Record<string, DaySchedule>;

const DEFAULT_DAY: DaySchedule = {
  start: '09:00',
  end: '19:00',
  breaks: [{ start: '12:00', end: '13:00' }],
  active: true,
};

export default function ScheduleConfigPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBarber, setSelectedBarber] = useState<string>('');
  const [schedule, setSchedule] = useState<Schedule>({});

  useEffect(() => {
    if (user?.role === 'master') {
      loadBarbers();
    } else if (user?.barberId) {
      setSelectedBarber(user.barberId);
    }
  }, [user]);

  useEffect(() => {
    if (selectedBarber) {
      loadSchedule(selectedBarber);
    }
  }, [selectedBarber]);

  const loadBarbers = async () => {
    try {
      const { items } = await api.admin.listBarbers();
      setBarbers(items);
      if (items.length > 0) {
        setSelectedBarber(items[0].id);
      }
    } catch (error) {
      console.error(error);
      toast({ title: 'Erro', description: 'Erro ao carregar barbeiros', variant: 'destructive' });
    }
  };

  const loadSchedule = async (barberId: string) => {
    setLoading(true);
    try {
      const data = await api.admin.getBarber(barberId);
      const loadedSchedule = data.schedule || {};
      
      // Fill missing days with default or disabled
      const fullSchedule: Schedule = {};
      DAYS.forEach(day => {
        if (loadedSchedule[day.key]) {
          fullSchedule[day.key] = loadedSchedule[day.key];
        } else {
          fullSchedule[day.key] = { ...DEFAULT_DAY, active: day.key !== '0' }; // Default closed on Sunday
        }
      });
      
      setSchedule(fullSchedule);
    } catch (error) {
      console.error(error);
      toast({ title: 'Erro', description: 'Erro ao carregar horários', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedBarber) return;
    setSaving(true);
    try {
      await api.admin.updateBarberSchedule(selectedBarber, schedule);
      toast({ title: 'Sucesso', description: 'Horários atualizados com sucesso.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Erro', description: 'Erro ao salvar horários', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const updateDay = (dayKey: string, updates: Partial<DaySchedule>) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...updates }
    }));
  };

  const addBreak = (dayKey: string) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        breaks: [...prev[dayKey].breaks, { start: '12:00', end: '13:00' }]
      }
    }));
  };

  const removeBreak = (dayKey: string, index: number) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        breaks: prev[dayKey].breaks.filter((_, i) => i !== index)
      }
    }));
  };

  const updateBreak = (dayKey: string, index: number, field: 'start' | 'end', value: string) => {
    setSchedule(prev => {
      const newBreaks = [...prev[dayKey].breaks];
      newBreaks[index] = { ...newBreaks[index], [field]: value };
      return {
        ...prev,
        [dayKey]: { ...prev[dayKey], breaks: newBreaks }
      };
    });
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-3xl font-serif font-bold tracking-tight">Configurar Horários</h2>
            <p className="text-muted-foreground">Defina sua disponibilidade semanal para agendamentos.</p>
          </div>
          
          {user?.role === 'master' && (
            <div className="w-full sm:w-[250px]">
              <Select value={selectedBarber} onValueChange={setSelectedBarber}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o barbeiro" />
                </SelectTrigger>
                <SelectContent>
                  {barbers.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-6">
            {DAYS.map(day => {
              const dayConfig = schedule[day.key] || DEFAULT_DAY;
              return (
                <Card key={day.key} className={`border-l-4 ${dayConfig.active ? 'border-l-primary' : 'border-l-muted'} transition-all hover:shadow-md`}>
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row gap-6 items-start">
                      <div className="flex items-center justify-between w-full md:w-48 shrink-0">
                        <div className="space-y-1">
                          <Label className="text-base font-semibold">{day.label}</Label>
                          <div className="flex items-center gap-2">
                            <Switch 
                              checked={dayConfig.active} 
                              onCheckedChange={(checked: boolean) => updateDay(day.key, { active: checked })}
                            />
                            <span className="text-sm text-muted-foreground">
                              {dayConfig.active ? 'Aberto' : 'Fechado'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {dayConfig.active && (
                        <div className="flex-1 space-y-4 w-full">
                          <div className="grid grid-cols-2 gap-4 max-w-md">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Início</Label>
                              <div className="relative">
                                <Clock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input 
                                  type="time" 
                                  className="pl-8" 
                                  value={dayConfig.start}
                                  onChange={(e) => updateDay(day.key, { start: e.target.value })}
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Fim</Label>
                              <div className="relative">
                                <Clock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input 
                                  type="time" 
                                  className="pl-8" 
                                  value={dayConfig.end}
                                  onChange={(e) => updateDay(day.key, { end: e.target.value })}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium text-muted-foreground">Intervalos / Pausas</Label>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => addBreak(day.key)}
                                className="h-8 text-xs"
                              >
                                <Plus className="h-3 w-3 mr-1" /> Adicionar Pausa
                              </Button>
                            </div>
                            
                            {dayConfig.breaks.map((brk, idx) => (
                              <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                <div className="grid grid-cols-2 gap-2 max-w-xs flex-1">
                                  <Input 
                                    type="time" 
                                    value={brk.start}
                                    onChange={(e) => updateBreak(day.key, idx, 'start', e.target.value)}
                                    className="h-8 text-sm"
                                  />
                                  <Input 
                                    type="time" 
                                    value={brk.end}
                                    onChange={(e) => updateBreak(day.key, idx, 'end', e.target.value)}
                                    className="h-8 text-sm"
                                  />
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                                  onClick={() => removeBreak(day.key, idx)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            {dayConfig.breaks.length === 0 && (
                              <p className="text-xs text-muted-foreground italic">Nenhuma pausa configurada.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="sticky bottom-6 flex justify-end pt-4">
          <Button 
            size="lg" 
            onClick={handleSave} 
            disabled={saving || loading}
            className="shadow-xl shadow-primary/20 min-w-[150px]"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Salvar Alterações
              </>
            )}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}