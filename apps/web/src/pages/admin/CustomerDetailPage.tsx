import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useToast } from '@/components/ui/use-toast';
import { SERVICE_LABELS } from '@/utils/constants';
import { 
  ArrowLeft, 
  Calendar, 
  Phone, 
  User, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Tag, 
  FileText,
  Scissors
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';

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
  if (!serviceType) return '—';
  return SERVICE_LABELS[serviceType] || serviceType;
}

function formatStatusLabel(status: string | undefined) {
  if (!status) return '—';
  if (status === 'booked') return 'Agendado';
  if (status === 'confirmed') return 'Confirmado';
  if (status === 'completed') return 'Concluído';
  if (status === 'no_show') return 'Falta';
  if (status === 'cancelled') return 'Cancelado';
  return status;
}

function getStatusBadgeVariant(status: string | undefined) {
  if (status === 'completed') return 'default'; // primary color usually green or dark
  if (status === 'confirmed') return 'secondary';
  if (status === 'no_show') return 'destructive';
  if (status === 'cancelled') return 'outline';
  return 'outline';
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
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/clientes')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-serif font-bold tracking-tight">Detalhes do Cliente</h2>
            <p className="text-muted-foreground">Visualize o histórico e informações completas.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : !customer ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">Cliente não encontrado.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {/* Left Column: Profile Info */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Perfil
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Nome Completo</p>
                    <p className="text-lg font-semibold">{titleName}</p>
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">WhatsApp</p>
                      <p>{whatsapp}</p>
                    </div>
                  </div>

                  {customer.profile?.birthday && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Aniversário</p>
                        <p>{new Date(customer.profile.birthday).toLocaleDateString('pt-BR')}</p>
                      </div>
                    </div>
                  )}

                  {customer.profile?.tags && customer.profile.tags.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {customer.profile.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {customer.profile?.notes && (
                    <div className="flex items-start gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground mt-1" />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Observações</p>
                        <p className="text-sm text-muted-foreground italic">{customer.profile.notes}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Stats & History */}
            <div className="md:col-span-2 space-y-6">
              {/* Stats Cards */}
              <div className="grid gap-4 grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Agendamentos</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{customer.stats?.totalBookings ?? 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Concluídos</CardTitle>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{customer.stats?.totalCompleted ?? 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Faltas</CardTitle>
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{customer.stats?.noShowCount ?? 0}</div>
                  </CardContent>
                </Card>
              </div>

              {/* History Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Histórico de Agendamentos
                  </CardTitle>
                  <CardDescription>
                    Últimos 50 agendamentos registrados.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <div className="relative w-full overflow-auto">
                      <table className="w-full caption-bottom text-sm">
                        <thead className="[&_tr]:border-b">
                          <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Data/Hora</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Serviço</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Profissional</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0">
                          {bookings.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-4 text-center text-muted-foreground">
                                Nenhum histórico encontrado.
                              </td>
                            </tr>
                          ) : (
                            bookings.map((b) => {
                              const dt = b.slotStart ? DateTime.fromISO(b.slotStart, { zone: 'America/Sao_Paulo' }) : null;
                              const when = dt && dt.isValid ? dt.toFormat('dd/LL/yyyy HH:mm') : '—';
                              const barberName = b.barberId ? barberNameById.get(b.barberId) || b.barberId : '—';
                              
                              return (
                                <tr key={b.id} className="border-b transition-colors hover:bg-muted/50">
                                  <td className="p-4 align-middle font-medium">{when}</td>
                                  <td className="p-4 align-middle">
                                    <div className="flex items-center gap-2">
                                      <Scissors className="h-3 w-3 text-muted-foreground" />
                                      {formatServiceLabel(b.serviceType)}
                                    </div>
                                  </td>
                                  <td className="p-4 align-middle">{barberName}</td>
                                  <td className="p-4 align-middle">
                                    <Badge variant={getStatusBadgeVariant(b.status)}>
                                      {formatStatusLabel(b.status)}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
