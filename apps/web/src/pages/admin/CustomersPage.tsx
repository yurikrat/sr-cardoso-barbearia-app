import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatDate } from '@/utils/dates';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  User, 
  Phone, 
  Calendar, 
  Download, 
  Star,
  AlertCircle,
  Users
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type TimestampLike =
  | { toDate?: () => Date }
  | Date
  | string
  | number
  | null
  | undefined;

function toDateSafe(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') {
    const d = maybe.toDate();
    return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

interface Customer {
  id: string;
  identity: {
    firstName: string;
    lastName: string;
    whatsappE164: string;
  };
  profile: {
    birthday?: string;
    notes?: string;
    tags?: string[];
  };
  stats: {
    totalBookings: number;
    totalCompleted?: number;
    lastBookingAt?: TimestampLike;
    noShowCount: number;
  };
}

export default function CustomersPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const { items } = await api.admin.listCustomers(1000); // Increased limit to get more customers
      setCustomers(items as Customer[]);
    } catch (error) {
      console.error('Error loading customers:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os clientes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter((customer) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      customer.identity.firstName.toLowerCase().includes(search) ||
      customer.identity.lastName.toLowerCase().includes(search) ||
      customer.identity.whatsappE164.includes(search)
    );
  });

  const handleExport = async () => {
    if (customers.length === 0) return;

    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Clientes');

    worksheet.columns = [
      { header: 'Nome', key: 'firstName', width: 20 },
      { header: 'Sobrenome', key: 'lastName', width: 20 },
      { header: 'WhatsApp', key: 'whatsapp', width: 20 },
      { header: 'Agendamentos', key: 'totalBookings', width: 15 },
      { header: 'Concluídos', key: 'totalCompleted', width: 15 },
      { header: 'Faltas', key: 'noShowCount', width: 10 },
      { header: 'Último Agendamento', key: 'lastBooking', width: 20 },
      { header: 'Aniversário', key: 'birthday', width: 15 },
    ];

    filteredCustomers.forEach((c) => {
      const lastBooking = toDateSafe(c.stats.lastBookingAt);
      worksheet.addRow({
        firstName: c.identity.firstName,
        lastName: c.identity.lastName,
        whatsapp: c.identity.whatsappE164,
        totalBookings: c.stats.totalBookings,
        totalCompleted: c.stats.totalCompleted ?? 0,
        noShowCount: c.stats.noShowCount,
        lastBooking: lastBooking ? formatDate(lastBooking) : '',
        birthday: c.profile.birthday ? new Date(c.profile.birthday).toLocaleDateString('pt-BR') : '',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes_sr_cardoso_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h2 className="text-3xl font-serif font-bold tracking-tight">Clientes</h2>
            <p className="text-muted-foreground">Gerencie a base de clientes da barbearia.</p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-[300px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou WhatsApp..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="icon" onClick={handleExport} title="Exportar Excel">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total de Clientes</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{customers.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Novos este mês</CardTitle>
                  <User className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {customers.filter(c => {
                      // Assuming we don't have 'createdAt', we can approximate with 'lastBookingAt' if it's their only booking?
                      // Or just leave it as a placeholder for now or calculate based on first booking if available.
                      // Since we don't have 'createdAt' in the interface, let's just show active customers (booked in last 30 days)
                      const last = toDateSafe(c.stats.lastBookingAt);
                      if (!last) return false;
                      const thirtyDaysAgo = new Date();
                      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                      return last > thirtyDaysAgo;
                    }).length}
                  </div>
                  <p className="text-xs text-muted-foreground">Ativos nos últimos 30 dias</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Aniversariantes do Mês</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {customers.filter(c => {
                      if (!c.profile.birthday) return false;
                      const bday = new Date(c.profile.birthday);
                      return bday.getMonth() === new Date().getMonth();
                    }).length}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="font-serif">Lista de Clientes</CardTitle>
                <CardDescription>
                  {filteredCustomers.length} cliente(s) encontrado(s).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Cliente</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Contato</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Histórico</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Última Visita</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {filteredCustomers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-4 text-center text-muted-foreground">
                              Nenhum cliente encontrado.
                            </td>
                          </tr>
                        ) : (
                          filteredCustomers.map((customer) => (
                            <tr
                              key={customer.id}
                              className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted cursor-pointer"
                              onClick={() => navigate(`/admin/clientes/${customer.id}`)}
                            >
                              <td className="p-4 align-middle">
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {customer.identity.firstName} {customer.identity.lastName}
                                  </span>
                                  {customer.profile.birthday && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      {new Date(customer.profile.birthday).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-4 align-middle">
                                <div className="flex items-center gap-2">
                                  <Phone className="h-3 w-3 text-muted-foreground" />
                                  <span>{customer.identity.whatsappE164}</span>
                                </div>
                              </td>
                              <td className="p-4 align-middle">
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs">
                                    {customer.stats.totalBookings} agendamentos
                                  </span>
                                  {customer.stats.noShowCount > 0 && (
                                    <span className="text-xs text-destructive flex items-center gap-1">
                                      <AlertCircle className="h-3 w-3" />
                                      {customer.stats.noShowCount} faltas
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-4 align-middle">
                                {(() => {
                                  const d = toDateSafe(customer.stats.lastBookingAt);
                                  return d ? (
                                    <span className="text-muted-foreground">{formatDate(d)}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  );
                                })()}
                              </td>
                              <td className="p-4 align-middle">
                                {(customer.stats.totalBookings ?? 0) > 5 ? (
                                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20">
                                    <Star className="h-3 w-3 mr-1 fill-current" />
                                    Fiel
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">Novo</Badge>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

