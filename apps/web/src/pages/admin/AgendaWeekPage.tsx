import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { DateTime } from 'luxon';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';

export default function AgendaWeekPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [selectedBarber, setSelectedBarber] = useState<string>('');
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [weekData, setWeekData] = useState<Record<string, { bookings: number; blocks: number }>>({});
  const [loading, setLoading] = useState(false);

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

        const nextBarber = sorted.find((b) => b.id === 'sr-cardoso')?.id ?? sorted[0]?.id ?? '';
        setSelectedBarber(nextBarber);
      } catch {
        setBarbers([]);
        setSelectedBarber('sr-cardoso');
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedBarber) return;
    loadWeekData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBarber]);

  const loadWeekData = async () => {
    setLoading(true);
    try {
      const today = DateTime.now().setZone('America/Sao_Paulo').setLocale('pt-BR');
      const weekStart = today.startOf('week');

      const startKey = weekStart.toFormat('yyyy-MM-dd');
      const { items } = await api.admin.weekSummary(selectedBarber, startKey, 6);
      setWeekData(items);
    } catch (error) {
      console.error('Error loading week data:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar a agenda da semana.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getDayName = (dateKey: string) => {
    const date = DateTime.fromFormat(dateKey, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' });
    return date.setLocale('pt-BR').toFormat('EEE, dd/MM');
  };

  const getDayColor = (bookings: number, blocks: number) => {
    if (bookings === 0 && blocks === 0) return 'bg-muted';
    if (bookings >= 10) return 'bg-primary';
    if (bookings >= 5) return 'bg-accent';
    return 'bg-secondary';
  };

  const today = DateTime.now().setZone('America/Sao_Paulo').setLocale('pt-BR');
  const weekStart = today.startOf('week');
  const weekDays = Array.from({ length: 6 }, (_, i) => {
    const day = weekStart.plus({ days: i });
    return day.toFormat('yyyy-MM-dd');
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-serif font-bold">Agenda da Semana</h2>
          <Button variant="outline" onClick={() => navigate('/admin/agenda')}>
            Ver agenda do dia
          </Button>
        </div>

        <Tabs value={selectedBarber} onValueChange={setSelectedBarber}>
          <div className="w-full overflow-x-auto">
            <TabsList className="w-max min-w-full justify-start flex-nowrap">
              {barbers.map((barber) => (
                <TabsTrigger key={barber.id} value={barber.id} className="whitespace-nowrap">
                  {barber.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {barbers.map((barber) => (
            <TabsContent key={barber.id} value={barber.id} className="space-y-4">
              {loading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {weekDays.map((dateKey) => {
                    const data = weekData[dateKey] || { bookings: 0, blocks: 0 };
                    const isToday = dateKey === today.toFormat('yyyy-MM-dd');
                    
                    return (
                      <Card
                        key={dateKey}
                        className={`cursor-pointer border-primary/10 bg-card/50 backdrop-blur-sm hover:bg-accent/40 transition-colors ${
                          isToday ? 'ring-2 ring-primary' : ''
                        }`}
                        onClick={() => {
                          navigate(`/admin/agenda?date=${dateKey}&barber=${selectedBarber}`);
                        }}
                      >
                        <CardContent className="p-4">
                          <div className="space-y-2">
                            <p className="font-semibold text-sm">{getDayName(dateKey)}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant="default">{data.bookings} reserva(s)</Badge>
                              {data.blocks > 0 && (
                                <Badge variant="outline">{data.blocks} bloqueado(s)</Badge>
                              )}
                            </div>
                            <div
                              className={`h-2 rounded ${getDayColor(data.bookings, data.blocks)}`}
                            />
                          </div>
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
    </AdminLayout>
  );
}

