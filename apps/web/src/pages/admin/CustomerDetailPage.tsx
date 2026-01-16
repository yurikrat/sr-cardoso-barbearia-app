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
import { applyPhoneMask, formatPhoneForDisplay, normalizeToE164 } from '@/utils/phone';
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
  Scissors,
  Edit2
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useAdminAutoRefreshToken } from '@/contexts/AdminAutoRefreshContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FirestoreTimestampLike = { toDate: () => Date };

type Customer = {
  id: string;
  identity?: { firstName?: string; lastName?: string; whatsappE164?: string };
  profile?: { birthday?: string; birthdayMmdd?: string; notes?: string; tags?: string[] };
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

const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function getBirthdayMmdd(customer: Customer): string | null {
  if (customer.profile?.birthdayMmdd && /^\d{4}$/.test(customer.profile.birthdayMmdd)) {
    return customer.profile.birthdayMmdd;
  }
  if (customer.profile?.birthday) {
    try {
      const d = new Date(customer.profile.birthday);
      if (!Number.isNaN(d.getTime())) {
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${month}${day}`;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function formatBirthdayDisplay(mmdd: string | null): string {
  if (!mmdd) return '—';
  const month = mmdd.slice(0, 2);
  const day = mmdd.slice(2, 4);
  return `${day}/${month}`;
}

export default function CustomerDetailPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { customerId } = useParams();
  const refreshToken = useAdminAutoRefreshToken();

  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');
  const [editBirthdayDay, setEditBirthdayDay] = useState('');
  const [editBirthdayMonth, setEditBirthdayMonth] = useState('');
  const [saving, setSaving] = useState(false);

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
  }, [customerId, toast, refreshToken]);

  const titleName = `${customer?.identity?.firstName ?? ''} ${customer?.identity?.lastName ?? ''}`.trim() || 'Cliente';
  const whatsapp = formatPhoneForDisplay(customer?.identity?.whatsappE164 ?? null);
  const birthdayMmdd = customer ? getBirthdayMmdd(customer) : null;

  const openEditProfile = () => {
    if (!customer) return;
    setEditFirstName(customer.identity?.firstName ?? '');
    setEditLastName(customer.identity?.lastName ?? '');
    setEditWhatsapp(customer.identity?.whatsappE164 ? formatPhoneForDisplay(customer.identity.whatsappE164) : '');
    if (birthdayMmdd) {
      setEditBirthdayMonth(birthdayMmdd.slice(0, 2));
      setEditBirthdayDay(birthdayMmdd.slice(2, 4));
    } else {
      setEditBirthdayMonth('');
      setEditBirthdayDay('');
    }
    setIsEditing(true);
  };

  const handleSaveProfile = async () => {
    if (!customerId) return;
    const firstName = editFirstName.trim();
    const lastName = editLastName.trim();

    if (!firstName || !lastName) {
      toast({
        title: 'Atenção',
        description: 'Nome e sobrenome são obrigatórios.',
        variant: 'destructive',
      });
      return;
    }

    let whatsappE164: string | null = null;
    if (editWhatsapp.trim()) {
      try {
        whatsappE164 = normalizeToE164(editWhatsapp);
      } catch {
        toast({
          title: 'Erro',
          description: 'WhatsApp inválido. Informe um número válido.',
          variant: 'destructive',
        });
        return;
      }
    }

    let birthdayMmddValue: string | null = null;
    if (editBirthdayMonth && editBirthdayDay) {
      birthdayMmddValue = `${editBirthdayMonth.padStart(2, '0')}${editBirthdayDay.padStart(2, '0')}`;
    }

    setSaving(true);
    try {
      const res = await api.admin.updateCustomer(customerId, {
        firstName,
        lastName,
        whatsappE164,
        birthdayMmdd: birthdayMmddValue,
      });

      setCustomer(res.item as Customer);
      setIsEditing(false);
      toast({
        title: 'Sucesso',
        description: 'Dados do cliente atualizados.',
      });
    } catch (error) {
      console.error('Error updating customer:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar o cliente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

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
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Perfil
                  </CardTitle>
                  <Button variant="outline" size="icon" onClick={openEditProfile}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
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

                  {birthdayMmdd && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Aniversário</p>
                        <p>{formatBirthdayDisplay(birthdayMmdd)}</p>
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

      <Dialog open={isEditing} onOpenChange={(open) => !open && setIsEditing(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5" />
              Editar Perfil
            </DialogTitle>
            <DialogDescription>
              Atualize os dados do cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-first-name">Nome</Label>
              <Input
                id="edit-first-name"
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
                placeholder="Nome"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-last-name">Sobrenome</Label>
              <Input
                id="edit-last-name"
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
                placeholder="Sobrenome"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-whatsapp">WhatsApp</Label>
              <Input
                id="edit-whatsapp"
                value={editWhatsapp}
                onChange={(e) => setEditWhatsapp(applyPhoneMask(e.target.value))}
                placeholder="(11) 99999-9999"
              />
            </div>

            <div className="space-y-2">
              <Label>Aniversário</Label>
              <div className="grid grid-cols-2 gap-4">
                <Select value={editBirthdayDay} onValueChange={setEditBirthdayDay}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Dia" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d).padStart(2, '0')}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={editBirthdayMonth} onValueChange={setEditBirthdayMonth}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS_PT.map((name, i) => (
                      <SelectItem key={name} value={String(i + 1).padStart(2, '0')}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setIsEditing(false)}
              disabled={saving}
              className="flex-1 sm:flex-none"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveProfile}
              disabled={saving}
              className="flex-1 sm:flex-none"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
