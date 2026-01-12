import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatDate } from '@/utils/dates';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { useAdminAutoRefreshToken } from '@/contexts/AdminAutoRefreshContext';
import { 
  Search, 
  User, 
  Phone, 
  Calendar, 
  Download, 
  Star,
  AlertCircle,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Cake,
  Edit2,
  X,
  Gift
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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
    birthdayMmdd?: string;
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

const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 100];
const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// Função para extrair mês/dia do birthdayMmdd ou birthday
function getBirthdayMmdd(customer: Customer): string | null {
  if (customer.profile.birthdayMmdd && /^\d{4}$/.test(customer.profile.birthdayMmdd)) {
    return customer.profile.birthdayMmdd;
  }
  if (customer.profile.birthday) {
    try {
      const d = new Date(customer.profile.birthday);
      if (!isNaN(d.getTime())) {
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

// Formatar data de aniversário para exibição (DD/MM)
function formatBirthdayDisplay(mmdd: string | null): string {
  if (!mmdd) return '-';
  const month = mmdd.slice(0, 2);
  const day = mmdd.slice(2, 4);
  return `${day}/${month}`;
}

export default function CustomersPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const refreshToken = useAdminAutoRefreshToken();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  
  // Modal de aniversariantes
  const [showBirthdayModal, setShowBirthdayModal] = useState(false);
  
  // Modal de edição de aniversário
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editBirthdayDay, setEditBirthdayDay] = useState('');
  const [editBirthdayMonth, setEditBirthdayMonth] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const { items } = await api.admin.listCustomers(2000);
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

  // Filtra clientes baseado na busca
  const filteredCustomers = useMemo(() => {
    if (!searchTerm) return customers;
    const search = searchTerm.toLowerCase();
    return customers.filter((customer) => 
      customer.identity.firstName.toLowerCase().includes(search) ||
      customer.identity.lastName.toLowerCase().includes(search) ||
      customer.identity.whatsappE164.includes(search)
    );
  }, [customers, searchTerm]);

  // Calcula aniversariantes do mês atual
  const birthdayCustomers = useMemo(() => {
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    return customers.filter(c => {
      const mmdd = getBirthdayMmdd(c);
      return mmdd && mmdd.startsWith(currentMonth);
    }).sort((a, b) => {
      const aDay = parseInt(getBirthdayMmdd(a)?.slice(2, 4) || '0', 10);
      const bDay = parseInt(getBirthdayMmdd(b)?.slice(2, 4) || '0', 10);
      return aDay - bDay;
    });
  }, [customers]);

  // Calcula clientes ativos (últimos 30 dias)
  const activeCustomers = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return customers.filter(c => {
      const last = toDateSafe(c.stats.lastBookingAt);
      return last && last > thirtyDaysAgo;
    });
  }, [customers]);

  // Paginação
  const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage);
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredCustomers.slice(start, start + itemsPerPage);
  }, [filteredCustomers, currentPage, itemsPerPage]);

  // Reset página quando busca ou items por página mudam
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, itemsPerPage]);

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
      const mmdd = getBirthdayMmdd(c);
      worksheet.addRow({
        firstName: c.identity.firstName,
        lastName: c.identity.lastName,
        whatsapp: c.identity.whatsappE164,
        totalBookings: c.stats.totalBookings,
        totalCompleted: c.stats.totalCompleted ?? 0,
        noShowCount: c.stats.noShowCount,
        lastBooking: lastBooking ? formatDate(lastBooking) : '',
        birthday: mmdd ? formatBirthdayDisplay(mmdd) : '',
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

  // Abre modal de edição de aniversário
  const openEditBirthdayModal = useCallback((customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation(); // Não navega para detalhes
    const mmdd = getBirthdayMmdd(customer);
    if (mmdd) {
      setEditBirthdayMonth(mmdd.slice(0, 2));
      setEditBirthdayDay(mmdd.slice(2, 4));
    } else {
      setEditBirthdayMonth('');
      setEditBirthdayDay('');
    }
    setEditingCustomer(customer);
  }, []);

  // Salva aniversário
  const handleSaveBirthday = async () => {
    if (!editingCustomer) return;

    setSaving(true);
    try {
      let birthdayMmdd: string | null = null;
      
      if (editBirthdayMonth && editBirthdayDay) {
        birthdayMmdd = `${editBirthdayMonth.padStart(2, '0')}${editBirthdayDay.padStart(2, '0')}`;
      }

      await api.admin.updateCustomer(editingCustomer.id, { birthdayMmdd });

      // Atualiza localmente
      setCustomers(prev => prev.map(c => {
        if (c.id === editingCustomer.id) {
          return {
            ...c,
            profile: {
              ...c.profile,
              birthdayMmdd: birthdayMmdd || undefined,
            }
          };
        }
        return c;
      }));

      toast({
        title: 'Sucesso',
        description: birthdayMmdd 
          ? `Aniversário de ${editingCustomer.identity.firstName} atualizado para ${formatBirthdayDisplay(birthdayMmdd)}`
          : `Aniversário de ${editingCustomer.identity.firstName} removido`,
      });

      setEditingCustomer(null);
    } catch (error) {
      console.error('Error saving birthday:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível salvar o aniversário.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Remove aniversário
  const handleRemoveBirthday = async () => {
    if (!editingCustomer) return;
    
    setSaving(true);
    try {
      await api.admin.updateCustomer(editingCustomer.id, { birthdayMmdd: null });

      // Atualiza localmente
      setCustomers(prev => prev.map(c => {
        if (c.id === editingCustomer.id) {
          return {
            ...c,
            profile: {
              ...c.profile,
              birthdayMmdd: undefined,
              birthday: undefined,
            }
          };
        }
        return c;
      }));

      toast({
        title: 'Sucesso',
        description: `Aniversário de ${editingCustomer.identity.firstName} removido`,
      });

      setEditingCustomer(null);
    } catch (error) {
      console.error('Error removing birthday:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível remover o aniversário.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-4 sm:space-y-6 pb-safe">
        {/* Header - Mobile optimized */}
        <div className="flex flex-col gap-3 sm:gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight">Clientes</h2>
            <p className="text-sm sm:text-base text-muted-foreground">Gerencie a base de clientes da barbearia.</p>
          </div>
          
          {/* Search and Export - Mobile friendly */}
          <div className="flex gap-2 w-full">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou WhatsApp..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 text-base" // Larger touch target (44px+)
              />
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleExport} 
              title="Exportar Excel"
              className="h-11 w-11 shrink-0" // Min 44px touch target
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* KPI Cards - Mobile grid */}
            <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
                  <CardTitle className="text-xs sm:text-sm font-medium">Total de Clientes</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground hidden sm:block" />
                </CardHeader>
                <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="text-xl sm:text-2xl font-bold">{customers.length}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
                  <CardTitle className="text-xs sm:text-sm font-medium">Ativos (30 dias)</CardTitle>
                  <User className="h-4 w-4 text-muted-foreground hidden sm:block" />
                </CardHeader>
                <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="text-xl sm:text-2xl font-bold">{activeCustomers.length}</div>
                </CardContent>
              </Card>
              
              {/* Birthday Card - Clickable */}
              <Card 
                className="col-span-2 lg:col-span-1 cursor-pointer hover:bg-accent/50 transition-colors active:bg-accent"
                onClick={() => setShowBirthdayModal(true)}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
                  <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-2">
                    <Gift className="h-4 w-4 text-pink-500" />
                    Aniversariantes de {MONTHS_PT[new Date().getMonth()]}
                  </CardTitle>
                  <Cake className="h-4 w-4 text-pink-500" />
                </CardHeader>
                <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="text-xl sm:text-2xl font-bold text-pink-600">{birthdayCustomers.length}</div>
                  <p className="text-xs text-muted-foreground mt-1">Toque para ver a lista</p>
                </CardContent>
              </Card>
            </div>

            {/* Customer List Card */}
            <Card>
              <CardHeader className="px-3 sm:px-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <CardTitle className="font-serif text-lg sm:text-xl">Lista de Clientes</CardTitle>
                    <CardDescription>
                      {filteredCustomers.length} cliente(s) encontrado(s)
                    </CardDescription>
                  </div>
                  {/* Items per page selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm text-muted-foreground">Exibir:</span>
                    <Select
                      value={String(itemsPerPage)}
                      onValueChange={(v) => setItemsPerPage(Number(v))}
                    >
                      <SelectTrigger className="w-20 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEMS_PER_PAGE_OPTIONS.map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                {/* Mobile Card Layout */}
                <div className="sm:hidden space-y-2 px-3">
                  {paginatedCustomers.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      Nenhum cliente encontrado.
                    </div>
                  ) : (
                    paginatedCustomers.map((customer) => {
                      const mmdd = getBirthdayMmdd(customer);
                      const lastBooking = toDateSafe(customer.stats.lastBookingAt);
                      
                      return (
                        <div
                          key={customer.id}
                          className="p-4 border rounded-lg bg-card active:bg-accent transition-colors"
                          onClick={() => navigate(`/admin/clientes/${customer.id}`)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold truncate">
                                  {customer.identity.firstName} {customer.identity.lastName}
                                </span>
                                {(customer.stats.totalBookings ?? 0) > 5 && (
                                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20 shrink-0">
                                    <Star className="h-3 w-3 mr-1 fill-current" />
                                    Fiel
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                <Phone className="h-3 w-3" />
                                <span>{customer.identity.whatsappE164}</span>
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{customer.stats.totalBookings} agendamentos</span>
                                {customer.stats.noShowCount > 0 && (
                                  <span className="text-destructive flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    {customer.stats.noShowCount} faltas
                                  </span>
                                )}
                                {lastBooking && (
                                  <span>Última: {formatDate(lastBooking)}</span>
                                )}
                              </div>
                            </div>
                            
                            {/* Birthday Button */}
                            <button
                              onClick={(e) => openEditBirthdayModal(customer, e)}
                              className="flex flex-col items-center justify-center p-2 rounded-lg hover:bg-muted active:bg-muted/80 min-w-[48px] min-h-[48px]"
                            >
                              {mmdd ? (
                                <>
                                  <Cake className="h-4 w-4 text-pink-500 mb-1" />
                                  <span className="text-xs font-medium">{formatBirthdayDisplay(mmdd)}</span>
                                </>
                              ) : (
                                <>
                                  <Calendar className="h-4 w-4 text-muted-foreground mb-1" />
                                  <span className="text-xs text-muted-foreground">Adicionar</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Desktop Table Layout */}
                <div className="hidden sm:block rounded-md border mx-0 sm:mx-0">
                  <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50">
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Cliente</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Contato</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Aniversário</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Histórico</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Última Visita</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {paginatedCustomers.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-muted-foreground">
                              Nenhum cliente encontrado.
                            </td>
                          </tr>
                        ) : (
                          paginatedCustomers.map((customer) => {
                            const mmdd = getBirthdayMmdd(customer);
                            
                            return (
                              <tr
                                key={customer.id}
                                className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                                onClick={() => navigate(`/admin/clientes/${customer.id}`)}
                              >
                                <td className="p-4 align-middle">
                                  <span className="font-medium">
                                    {customer.identity.firstName} {customer.identity.lastName}
                                  </span>
                                </td>
                                <td className="p-4 align-middle">
                                  <div className="flex items-center gap-2">
                                    <Phone className="h-3 w-3 text-muted-foreground" />
                                    <span>{customer.identity.whatsappE164}</span>
                                  </div>
                                </td>
                                <td className="p-4 align-middle">
                                  <button
                                    onClick={(e) => openEditBirthdayModal(customer, e)}
                                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted transition-colors min-h-[36px]"
                                  >
                                    {mmdd ? (
                                      <>
                                        <Cake className="h-4 w-4 text-pink-500" />
                                        <span>{formatBirthdayDisplay(mmdd)}</span>
                                        <Edit2 className="h-3 w-3 text-muted-foreground" />
                                      </>
                                    ) : (
                                      <>
                                        <Calendar className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-muted-foreground">Adicionar</span>
                                      </>
                                    )}
                                  </button>
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
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-3 sm:px-0 pt-4">
                    <p className="text-sm text-muted-foreground text-center sm:text-left">
                      Mostrando {((currentPage - 1) * itemsPerPage) + 1} a {Math.min(currentPage * itemsPerPage, filteredCustomers.length)} de {filteredCustomers.length}
                    </p>
                    
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                      >
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      
                      <span className="px-3 text-sm font-medium min-w-[80px] text-center">
                        {currentPage} / {totalPages}
                      </span>
                      
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Birthday List Modal */}
      <Dialog open={showBirthdayModal} onOpenChange={setShowBirthdayModal}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cake className="h-5 w-5 text-pink-500" />
              Aniversariantes de {MONTHS_PT[new Date().getMonth()]}
            </DialogTitle>
            <DialogDescription>
              {birthdayCustomers.length} cliente(s) fazem aniversário este mês
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            {birthdayCustomers.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Gift className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nenhum aniversariante este mês</p>
              </div>
            ) : (
              <div className="space-y-2">
                {birthdayCustomers.map((customer) => {
                  const mmdd = getBirthdayMmdd(customer);
                  const day = mmdd ? parseInt(mmdd.slice(2, 4), 10) : 0;
                  const today = new Date().getDate();
                  const isToday = day === today;
                  
                  return (
                    <div
                      key={customer.id}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer active:bg-accent ${
                        isToday ? 'bg-pink-50 dark:bg-pink-950/20 border-pink-200 dark:border-pink-900' : ''
                      }`}
                      onClick={() => {
                        setShowBirthdayModal(false);
                        navigate(`/admin/clientes/${customer.id}`);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">
                              {customer.identity.firstName} {customer.identity.lastName}
                            </span>
                            {isToday && (
                              <Badge className="bg-pink-500 text-white shrink-0">
                                Hoje! 🎂
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {customer.identity.whatsappE164}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-lg font-bold text-pink-600">{day}</div>
                          <div className="text-xs text-muted-foreground">
                            {MONTHS_PT[new Date().getMonth()].slice(0, 3)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setShowBirthdayModal(false)} className="w-full sm:w-auto">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Birthday Modal */}
      <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Editar Aniversário
            </DialogTitle>
            <DialogDescription>
              {editingCustomer?.identity.firstName} {editingCustomer?.identity.lastName}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="birthday-day">Dia</Label>
                <Select value={editBirthdayDay} onValueChange={setEditBirthdayDay}>
                  <SelectTrigger id="birthday-day" className="h-11">
                    <SelectValue placeholder="Dia" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <SelectItem key={d} value={String(d).padStart(2, '0')}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="birthday-month">Mês</Label>
                <Select value={editBirthdayMonth} onValueChange={setEditBirthdayMonth}>
                  <SelectTrigger id="birthday-month" className="h-11">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS_PT.map((name, i) => (
                      <SelectItem key={i} value={String(i + 1).padStart(2, '0')}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {(editBirthdayDay || editBirthdayMonth) && (
              <p className="text-sm text-muted-foreground text-center">
                Data selecionada: {editBirthdayDay || '--'}/{editBirthdayMonth || '--'}
              </p>
            )}
          </div>
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {editingCustomer && getBirthdayMmdd(editingCustomer) && (
              <Button 
                variant="ghost" 
                onClick={handleRemoveBirthday}
                disabled={saving}
                className="text-destructive hover:text-destructive w-full sm:w-auto"
              >
                <X className="h-4 w-4 mr-2" />
                Remover
              </Button>
            )}
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              <Button 
                variant="outline" 
                onClick={() => setEditingCustomer(null)}
                disabled={saving}
                className="flex-1 sm:flex-none"
              >
                Cancelar
              </Button>
              <Button 
                onClick={handleSaveBirthday}
                disabled={saving || (!editBirthdayDay || !editBirthdayMonth)}
                className="flex-1 sm:flex-none"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

