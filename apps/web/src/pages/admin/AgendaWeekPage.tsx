import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { DateTime } from 'luxon';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { BARBERS } from '@/utils/constants';

export default function AgendaWeekPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [selectedBarber, setSelectedBarber] = useState<string>('sr-cardoso');
  const [weekData, setWeekData] = useState<Record<string, { bookings: number; blocks: number }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadWeekData();
  }, [selectedBarber]);

  const loadWeekData = async () => {
    setLoading(true);
    try {
      const today = DateTime.now().setZone('America/Sao_Paulo');
      const weekStart = today.startOf('week'); // Segunda-feira
      
      const weekDays: Record<string, { bookings: number; blocks: number }> = {};
      
      // Inicializar todos os dias da semana (segunda a sábado, domingo não conta)
      for (let i = 0; i < 6; i++) {
        const day = weekStart.plus({ days: i });
        const dateKey = day.toFormat('yyyy-MM-dd');
        weekDays[dateKey] = { bookings: 0, blocks: 0 };
      }

      // Buscar bookings da semana
      const bookingsRef = collection(db, 'bookings');
      const bookingsQuery = query(
        bookingsRef,
        where('barberId', '==', selectedBarber),
        where('dateKey', '>=', weekStart.toFormat('yyyy-MM-dd')),
        where('dateKey', '<=', weekStart.plus({ days: 5 }).toFormat('yyyy-MM-dd'))
      );

      const bookingsSnapshot = await getDocs(bookingsQuery);
      bookingsSnapshot.forEach((doc) => {
        const data = doc.data();
        const dateKey = data.dateKey;
        if (weekDays[dateKey]) {
          weekDays[dateKey].bookings++;
        }
      });

      // Buscar blocks da semana
      const slotsRef = collection(db, `barbers/${selectedBarber}/slots`);
      const slotsQuery = query(slotsRef);
      const slotsSnapshot = await getDocs(slotsQuery);
      
      slotsSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.kind === 'block' && weekDays[data.dateKey]) {
          weekDays[data.dateKey].blocks++;
        }
      });

      setWeekData(weekDays);
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
    return date.toFormat('EEE, dd/MM', { locale: 'pt-BR' });
  };

  const getDayColor = (bookings: number, blocks: number) => {
    if (bookings === 0 && blocks === 0) return 'bg-muted';
    if (bookings >= 10) return 'bg-primary';
    if (bookings >= 5) return 'bg-accent';
    return 'bg-secondary';
  };

  const today = DateTime.now().setZone('America/Sao_Paulo');
  const weekStart = today.startOf('week');
  const weekDays = Array.from({ length: 6 }, (_, i) => {
    const day = weekStart.plus({ days: i });
    return day.toFormat('yyyy-MM-dd');
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-serif font-bold">Agenda da Semana</h2>
          <button
            onClick={() => navigate('/admin/agenda')}
            className="text-sm text-primary hover:underline"
          >
            Ver agenda do dia →
          </button>
        </div>

        <Tabs value={selectedBarber} onValueChange={setSelectedBarber}>
          <TabsList>
            {BARBERS.map((barber) => (
              <TabsTrigger key={barber.id} value={barber.id}>
                {barber.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {BARBERS.map((barber) => (
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
                        className={`cursor-pointer hover:bg-accent transition-colors ${
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

