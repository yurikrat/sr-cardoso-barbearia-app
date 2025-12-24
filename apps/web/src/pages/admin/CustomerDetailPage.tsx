import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useToast } from '@/components/ui/use-toast';

type FirestoreTimestampLike = { toDate: () => Date };

type Customer = {
  id: string;
  identity?: { firstName?: string; lastName?: string; whatsappE164?: string };
  profile?: { birthday?: string; notes?: string; tags?: string[] };
  stats?: {
    totalBookings?: number;
    totalCompleted?: number;
    noShowCount?: number;
    firstBookingAt?: FirestoreTimestampLike;
    lastBookingAt?: FirestoreTimestampLike;
  };
};

type Booking = {
  id: string;
  barberId?: string;
  dateKey?: string;
  slotStart?: string | null;
  serviceType?: string;
  status?: string;
  customer?: { firstName?: string; lastName?: string; whatsappE164?: string };
};

function formatServiceLabel(serviceType: string | undefined) {
  if (serviceType === 'cabelo') return 'Cabelo';
  if (serviceType === 'barba') return 'Barba';
  if (serviceType === 'cabelo_barba') return 'Cabelo + Barba';
  return serviceType || '—';
}

function formatStatusLabel(status: string | undefined) {
  return status || '—';
}

export default function CustomerDetailPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { customerId } = useParams();

  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);

  const barberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of barbers) map.set(b.id, b.name);
    return map;
  }, [barbers]);

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    void (async () => {
      try {
        const [customerRes, bookingsRes, barbersRes] = await Promise.all([
          api.admin.getCustomer(customerId),
          api.admin.listCustomerBookings(customerId, 50),
          api.admin.listBarbers(),
        ]);
        setCustomer(customerRes.item as Customer);
        setBookings((bookingsRes.items ?? []) as Booking[]);
        setBarbers((barbersRes.items ?? []).map((b) => ({ id: b.id, name: b.name })));
      } catch (error) {
        console.error('Error loading customer detail:', error);
        toast({
          title: 'Erro',
          description: 'Não foi possível carregar o cliente.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [customerId, toast]);

  const titleName = `${customer?.identity?.firstName ?? ''} ${customer?.identity?.lastName ?? ''}`.trim() || 'Cliente';
  const whatsapp = customer?.identity?.whatsappE164 || '—';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <h2 className="text-2xl font-serif font-bold">{titleName}</h2>
            <p className="text-sm text-muted-foreground">{whatsapp}</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/admin/clientes')}>Voltar</Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : !customer ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">Cliente não encontrado.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Agendamentos</p>
                    <p className="text-xl font-semibold">{customer.stats?.totalBookings ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Concluídos</p>
                    <p className="text-xl font-semibold">{customer.stats?.totalCompleted ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Faltas</p>
                    <p className="text-xl font-semibold">{customer.stats?.noShowCount ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Histórico (últimos 50)</h3>
                  <span className="text-sm text-muted-foreground">{bookings.length} item(ns)</span>
                </div>

                <div className="mt-4 space-y-2">
                  {bookings.length === 0 ? (
                    <div className="py-6 text-center text-muted-foreground">Sem histórico.</div>
                  ) : (
                    bookings.map((b) => {
                      const dt = b.slotStart ? DateTime.fromISO(b.slotStart, { zone: 'America/Sao_Paulo' }) : null;
                      const when = dt && dt.isValid ? dt.toFormat('dd/LL/yyyy HH:mm') : '—';
                      const barberName = b.barberId ? barberNameById.get(b.barberId) || b.barberId : '—';
                      return (
                        <div key={b.id} className="flex items-start justify-between rounded-md border p-3">
                          <div>
                            <p className="font-medium">{when}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatServiceLabel(b.serviceType)} · {barberName}
                            </p>
                          </div>
                          <Badge variant="outline">{formatStatusLabel(b.status)}</Badge>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
