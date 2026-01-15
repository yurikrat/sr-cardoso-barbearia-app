import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  Calendar,
  TrendingUp,
  CheckCircle,
  Scissors,
  Wallet,
  Activity,
  ArrowUpRight,
  Users,
  Download,
  Trash2,
  Info,
  Package,
  ShoppingBag
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAdminAutoRefreshToken } from '@/contexts/AdminAutoRefreshContext';

function formatMoneyBRLFromCents(cents: number): string {
  const value = (cents || 0) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatStatusPtBr(status: string): string {
  switch (status) {
    case 'booked':
      return 'Agendado';
    case 'confirmed':
      return 'Confirmado';
    case 'completed':
      return 'Concluído';
    case 'no_show':
      return 'Falta';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status;
  }
}

export default function FinancePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const refreshToken = useAdminAutoRefreshToken();
  const isMaster = user?.role === 'master';
  const isBarber = user?.role === 'barber';

  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<string>('all');

  // Sincroniza o barbeiro selecionado com o perfil do usuário se não for master
  useEffect(() => {
    if (user && user.role === 'barber' && user.barberId) {
      setSelectedBarberId(user.barberId);
    }
  }, [user]);

  // Tipo de período: dia, semana, mês, ano
  const [periodType, setPeriodType] = useState<'day' | 'week' | 'month' | 'year'>('month');
  
  // Valores selecionados para cada tipo de período
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    return DateTime.now().setZone('America/Sao_Paulo').toFormat('yyyy-MM-dd');
  });
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    return now.startOf('week').toFormat('yyyy-MM-dd');
  });
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    return now.toFormat('yyyy-MM');
  });
  const [selectedYear, setSelectedYear] = useState<string>(() => {
    return DateTime.now().setZone('America/Sao_Paulo').toFormat('yyyy');
  });
  // Filtro de origem da receita: serviços, produtos ou todos
  const [revenueSource, setRevenueSource] = useState<'services' | 'products' | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [summary, setSummary] = useState<null | {
    totalBookings: number;
    revenueCents: number;
    estimatedRevenueCents?: number;
    realizedRevenueCents?: number;
    estimatedBarberCents?: number;
    estimatedShopCents?: number;
    realizedBarberCents?: number;
    realizedShopCents?: number;
    projectionRevenueCents?: number | null;
    countsByServiceType: Record<string, number>;
    countsByStatus: Record<string, number>;
    countsByPaymentMethod?: Record<string, number>;
    revenueByPaymentMethod?: Record<string, number>;
    serviceCatalog?: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>;
    commissions?: { defaultBarberPct: number; ownerBarberPct: number };
  }>(null);

  type FinanceConfig = {
    commissions: { defaultBarberPct: number; ownerBarberPct: number };
    services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>;
  };

  const [configDraft, setConfigDraft] = useState<FinanceConfig | null>(null);

  // Dados de vendas de produtos
  type ProductsSummary = {
    totalSales: number;
    totalRevenueCents: number;
    totalCommissionCents: number;
    totalItemsSold: number;
    byCategory: Array<{
      categoryId: string;
      categoryName: string;
      revenueCents: number;
      itemsSold: number;
    }>;
    byProduct: Array<{
      productId: string;
      productName: string;
      revenueCents: number;
      quantitySold: number;
    }>;
    byPaymentMethod: Array<{
      method: 'credit' | 'debit' | 'cash' | 'pix';
      revenueCents: number;
      count: number;
    }>;
  };
  const [productsSummary, setProductsSummary] = useState<ProductsSummary | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { items } = await api.admin.listBarbers();
        const normalized = (items ?? []).map((b) => ({ id: b.id, name: b.name }));
        setBarbers(normalized);
      } catch {
        setBarbers([]);
      }
    })();
  }, [refreshToken]);

  useEffect(() => {
    if (!isMaster) {
      setConfigDraft(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingConfig(true);
      try {
        const data = await api.admin.getFinanceConfig();
        if (cancelled) return;
        setConfigDraft(data.config);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : null;
        toast({
          title: 'Erro',
          description: message || 'Não foi possível carregar as configurações do financeiro.',
          variant: 'destructive',
        });
        if (!cancelled) setConfigDraft(null);
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMaster, toast, refreshToken]);

  const monthOptions = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo').startOf('month');
    return Array.from({ length: 12 }, (_, i) => now.minus({ months: i })).map((dt) => ({
      value: dt.toFormat('yyyy-MM'),
      label: dt.toFormat('LLLL yyyy', { locale: 'pt-BR' }),
    }));
  }, []);

  // Opções para seletor de dias (últimos 30 dias)
  const dayOptions = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo').startOf('day');
    return Array.from({ length: 30 }, (_, i) => now.minus({ days: i })).map((dt) => ({
      value: dt.toFormat('yyyy-MM-dd'),
      label: dt.toFormat("dd 'de' MMMM", { locale: 'pt-BR' }),
    }));
  }, []);

  // Opções para seletor de semanas (últimas 12 semanas)
  const weekOptions = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo').startOf('week');
    return Array.from({ length: 12 }, (_, i) => now.minus({ weeks: i })).map((dt) => {
      const weekEnd = dt.endOf('week');
      return {
        value: dt.toFormat('yyyy-MM-dd'),
        label: `${dt.toFormat("dd/MM", { locale: 'pt-BR' })} - ${weekEnd.toFormat("dd/MM", { locale: 'pt-BR' })}`,
      };
    });
  }, []);

  // Opções para seletor de anos (últimos 3 anos)
  const yearOptions = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    return Array.from({ length: 3 }, (_, i) => now.minus({ years: i })).map((dt) => ({
      value: dt.toFormat('yyyy'),
      label: dt.toFormat('yyyy'),
    }));
  }, []);

  // Calcula startDateKey e endDateKey baseado no tipo de período
  const { startDateKey, endDateKey, periodLabel } = useMemo(() => {
    switch (periodType) {
      case 'day': {
        const day = DateTime.fromFormat(selectedDay, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' });
        return {
          startDateKey: day.toFormat('yyyy-MM-dd'),
          endDateKey: day.toFormat('yyyy-MM-dd'),
          periodLabel: day.toFormat("dd 'de' MMMM 'de' yyyy", { locale: 'pt-BR' }),
        };
      }
      case 'week': {
        const weekStart = DateTime.fromFormat(selectedWeek, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' });
        const weekEnd = weekStart.endOf('week');
        return {
          startDateKey: weekStart.toFormat('yyyy-MM-dd'),
          endDateKey: weekEnd.toFormat('yyyy-MM-dd'),
          periodLabel: `${weekStart.toFormat("dd/MM", { locale: 'pt-BR' })} a ${weekEnd.toFormat("dd/MM/yyyy", { locale: 'pt-BR' })}`,
        };
      }
      case 'month': {
        const start = DateTime.fromFormat(selectedMonth, 'yyyy-MM', { zone: 'America/Sao_Paulo' }).startOf('month');
        const end = start.endOf('month');
        return {
          startDateKey: start.toFormat('yyyy-MM-dd'),
          endDateKey: end.toFormat('yyyy-MM-dd'),
          periodLabel: start.toFormat('LLLL yyyy', { locale: 'pt-BR' }),
        };
      }
      case 'year': {
        const yearStart = DateTime.fromFormat(selectedYear, 'yyyy', { zone: 'America/Sao_Paulo' }).startOf('year');
        const yearEnd = yearStart.endOf('year');
        return {
          startDateKey: yearStart.toFormat('yyyy-MM-dd'),
          endDateKey: yearEnd.toFormat('yyyy-MM-dd'),
          periodLabel: selectedYear,
        };
      }
    }
  }, [periodType, selectedDay, selectedWeek, selectedMonth, selectedYear]);

  const handleExport = async () => {
    if (!summary) return;

    const barberPct = summary.commissions
      ? selectedBarberId === 'sr-cardoso'
        ? summary.commissions.ownerBarberPct
        : summary.commissions.defaultBarberPct
      : null;

    const displayedEstimatedCents = isBarber ? (summary.estimatedBarberCents ?? 0) : (summary.estimatedRevenueCents ?? 0);
    const displayedRealizedCents = isBarber ? (summary.realizedBarberCents ?? 0) : (summary.realizedRevenueCents ?? 0);
    const projectionBaseCents = summary.projectionRevenueCents ?? summary.revenueCents ?? 0;
    const displayedProjectionCents = isBarber && barberPct != null ? Math.round(projectionBaseCents * barberPct) : projectionBaseCents;
    const displayedTotalCents = isBarber
      ? (summary.estimatedBarberCents ?? 0) + (summary.realizedBarberCents ?? 0)
      : (summary.revenueCents ?? 0);

    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();

    // Sheet 1: Resumo
    const wsSummary = workbook.addWorksheet('Resumo');
    wsSummary.columns = [
      { header: 'Métrica', key: 'metric', width: 30 },
      { header: 'Valor', key: 'value', width: 20 },
    ];
    wsSummary.addRows([
      ['Período', periodLabel],
      ['Agendamentos', summary.totalBookings],
      ['Previsto', displayedEstimatedCents / 100],
      ['Realizado', displayedRealizedCents / 100],
      ['Projeção', displayedProjectionCents / 100],
      ['Total', displayedTotalCents / 100],
      [],
      ['Previsto (Profissional)', (summary.estimatedBarberCents ?? 0) / 100],
      ...(isBarber ? [] : [['Previsto (Barbearia)', (summary.estimatedShopCents ?? 0) / 100]]),
      ['Realizado (Profissional)', (summary.realizedBarberCents ?? 0) / 100],
      ...(isBarber ? [] : [['Realizado (Barbearia)', (summary.realizedShopCents ?? 0) / 100]]),
    ]);

    // Sheet 2: Serviços
    const wsServices = workbook.addWorksheet('Serviços');
    wsServices.columns = [
      { header: 'ID', key: 'id', width: 20 },
      { header: 'Serviço', key: 'label', width: 30 },
      { header: 'Preço Unitário', key: 'price', width: 15 },
      { header: 'Quantidade', key: 'count', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
    ];

    const catalog = (summary.serviceCatalog ?? []).filter((s) => s.active);
    const known = new Set(catalog.map((s) => s.id));
    const unknownIds = Object.keys(summary.countsByServiceType || {}).filter((id) => !known.has(id));
    
    catalog.forEach(s => {
      const count = summary.countsByServiceType[s.id] ?? 0;
      wsServices.addRow([s.id, s.label, s.priceCents / 100, count, (count * s.priceCents) / 100]);
    });
    unknownIds.forEach(id => {
      const count = summary.countsByServiceType[id] ?? 0;
      wsServices.addRow([id, id, 0, count, 0]);
    });

    // Sheet 3: Status
    const wsStatus = workbook.addWorksheet('Status');
    wsStatus.columns = [
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Quantidade', key: 'count', width: 15 },
    ];
    Object.entries(summary.countsByStatus).forEach(([status, count]) => {
      wsStatus.addRow([formatStatusPtBr(status), count]);
    });

    // Sheet 4: Formas de Pagamento
    const wsPayment = workbook.addWorksheet('Formas de Pagamento');
    wsPayment.columns = [
      { header: 'Forma de Pagamento', key: 'method', width: 25 },
      { header: 'Quantidade', key: 'count', width: 15 },
      { header: 'Receita', key: 'revenue', width: 15 },
    ];
    const paymentMethodLabels: Record<string, string> = {
      credit: 'Cartão de Crédito',
      debit: 'Cartão de Débito',
      cash: 'Dinheiro',
      pix: 'Pix',
    };
    if (summary.countsByPaymentMethod) {
      Object.entries(summary.countsByPaymentMethod).forEach(([method, count]) => {
        const revenueCents = summary.revenueByPaymentMethod?.[method] ?? 0;
        wsPayment.addRow([paymentMethodLabels[method] ?? method, count, revenueCents / 100]);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Nome do arquivo baseado no período selecionado
    const filenameSuffix = periodType === 'day' ? selectedDay 
      : periodType === 'week' ? `semana_${selectedWeek}` 
      : periodType === 'month' ? selectedMonth 
      : selectedYear;
    a.download = `financeiro_${filenameSuffix}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const barberId = selectedBarberId === 'all' ? null : selectedBarberId;
        
        // Buscar dados de serviços
        const data = await api.admin.financeSummary({ startDateKey, endDateKey, barberId });
        setSummary({
          totalBookings: data.totalBookings,
          revenueCents: data.revenueCents,
          estimatedRevenueCents: data.estimatedRevenueCents,
          realizedRevenueCents: data.realizedRevenueCents,
          estimatedBarberCents: data.estimatedBarberCents,
          estimatedShopCents: data.estimatedShopCents,
          realizedBarberCents: data.realizedBarberCents,
          realizedShopCents: data.realizedShopCents,
          projectionRevenueCents: data.projectionRevenueCents,
          countsByServiceType: data.countsByServiceType,
          countsByStatus: data.countsByStatus,
          countsByPaymentMethod: data.countsByPaymentMethod,
          revenueByPaymentMethod: data.revenueByPaymentMethod,
          serviceCatalog: data.serviceCatalog,
          commissions: data.commissions,
        });
        
        // Buscar dados de produtos
        const productsData = await api.admin.getProductsSummary({
          startDate: startDateKey,
          endDate: endDateKey,
          barberId: barberId ?? undefined,
        });
        setProductsSummary(productsData);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : null;
        toast({
          title: 'Erro',
          description: message || 'Não foi possível carregar o financeiro.',
          variant: 'destructive',
        });
        setSummary(null);
        setProductsSummary(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [startDateKey, endDateKey, selectedBarberId, toast, refreshToken]);

  return (
    <AdminLayout>
      <TooltipProvider>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h2 className="text-3xl font-serif font-bold tracking-tight">Financeiro</h2>
            <p className="text-muted-foreground">{isBarber ? 'Acompanhe seus resultados.' : 'Acompanhe o desempenho da barbearia.'}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Select 
              value={selectedBarberId} 
              onValueChange={setSelectedBarberId}
              disabled={!isMaster}
            >
              <SelectTrigger className="w-full sm:w-[240px]">
                <SelectValue placeholder="Profissional" />
              </SelectTrigger>
              <SelectContent>
                {isMaster && <SelectItem value="all">Todos os profissionais</SelectItem>}
                {barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Seletor de tipo de período */}
            <Select value={periodType} onValueChange={(v) => setPeriodType(v as 'day' | 'week' | 'month' | 'year')}>
              <SelectTrigger className="w-full sm:w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Dia</SelectItem>
                <SelectItem value="week">Semana</SelectItem>
                <SelectItem value="month">Mês</SelectItem>
                <SelectItem value="year">Ano</SelectItem>
              </SelectContent>
            </Select>

            {/* Seletor específico baseado no tipo de período */}
            {periodType === 'day' && (
              <Select value={selectedDay} onValueChange={setSelectedDay}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dayOptions.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {periodType === 'week' && (
              <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekOptions.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {periodType === 'month' && (
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {periodType === 'year' && (
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-full sm:w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y.value} value={y.value}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Seletor de origem da receita */}
            <Select value={revenueSource} onValueChange={(v) => setRevenueSource(v as 'services' | 'products' | 'all')}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tudo</SelectItem>
                <SelectItem value="services">Serviços</SelectItem>
                <SelectItem value="products">Produtos</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={handleExport} disabled={!summary} title="Exportar Excel">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : !summary ? (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <Activity className="h-10 w-10 opacity-20" />
                <p>Nenhum dado disponível para o período selecionado.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {(() => {
              const pct = summary.commissions
                ? selectedBarberId === 'sr-cardoso'
                  ? summary.commissions.ownerBarberPct
                  : summary.commissions.defaultBarberPct
                : null;

              // Valores de serviços
              const servicesEstimatedCents = isBarber ? (summary.estimatedBarberCents ?? 0) : (summary.estimatedRevenueCents ?? 0);
              const servicesRealizedCents = isBarber ? (summary.realizedBarberCents ?? 0) : (summary.realizedRevenueCents ?? 0);
              const servicesProjectionCents = summary.projectionRevenueCents ?? summary.revenueCents;
              const servicesProjectionDisplayed = isBarber && pct != null ? Math.round(servicesProjectionCents * pct) : servicesProjectionCents;

              // Valores de produtos
              const productsRevenueCents = productsSummary?.totalRevenueCents ?? 0;
              const productsCommissionCents = productsSummary?.totalCommissionCents ?? 0;
              // Para barbers, mostrar comissão; para master, mostrar total
              const productsDisplayedCents = isBarber ? productsCommissionCents : productsRevenueCents;
              const productsBarberiaCents = productsRevenueCents - productsCommissionCents;

              // Valores combinados baseados no filtro
              let displayedEstimatedCents: number;
              let displayedRealizedCents: number;
              let displayedProjectionCents: number;
              let showProductsBreakdown = false;

              switch (revenueSource) {
                case 'services':
                  displayedEstimatedCents = servicesEstimatedCents;
                  displayedRealizedCents = servicesRealizedCents;
                  displayedProjectionCents = servicesProjectionDisplayed;
                  break;
                case 'products':
                  displayedEstimatedCents = 0; // Produtos não têm "previsto"
                  displayedRealizedCents = productsDisplayedCents;
                  displayedProjectionCents = productsDisplayedCents; // Projeção = realizado para produtos
                  showProductsBreakdown = true;
                  break;
                default: // 'all'
                  displayedEstimatedCents = servicesEstimatedCents;
                  displayedRealizedCents = servicesRealizedCents + productsDisplayedCents;
                  displayedProjectionCents = servicesProjectionDisplayed + productsDisplayedCents;
                  showProductsBreakdown = productsRevenueCents > 0;
              }

              return (
                <>
                  {/* KPI Grid */}
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Card de Agendamentos/Vendas */}
              {revenueSource !== 'products' && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Agendamentos</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.totalBookings}</div>
                  <p className="text-xs text-muted-foreground">
                    {periodType === 'day' && 'Total no dia'}
                    {periodType === 'week' && 'Total na semana'}
                    {periodType === 'month' && 'Total no mês'}
                    {periodType === 'year' && 'Total no ano'}
                  </p>
                </CardContent>
              </Card>
              )}

              {/* Card de Vendas de Produtos */}
              {(revenueSource === 'products' || revenueSource === 'all') && productsSummary && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Vendas de Produtos</CardTitle>
                  <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{productsSummary.totalSales}</div>
                  <p className="text-xs text-muted-foreground">
                    {productsSummary.totalItemsSold} {productsSummary.totalItemsSold === 1 ? 'item vendido' : 'itens vendidos'}
                  </p>
                </CardContent>
              </Card>
              )}

              {revenueSource !== 'products' && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Previsto</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMoneyBRLFromCents(displayedEstimatedCents)}</div>
                  {isMaster && (summary.estimatedBarberCents != null || summary.estimatedShopCents != null) && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                      <span>P: {formatMoneyBRLFromCents(summary.estimatedBarberCents ?? 0)}</span>
                      <span>B: {formatMoneyBRLFromCents(summary.estimatedShopCents ?? 0)}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex items-center" aria-label="Entenda P e B">
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <div className="space-y-1">
                            <div className="font-medium">Divisão (P/B)</div>
                            <div>P = Profissional (comissão)</div>
                            <div>B = Barbearia</div>
                            <div className="text-muted-foreground">Previsto: soma de Agendado + Confirmado.</div>
                            <div className="text-muted-foreground">Dono (Sr. Cardoso): P=100%.</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </CardContent>
              </Card>
              )}

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Realizado</CardTitle>
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMoneyBRLFromCents(displayedRealizedCents)}</div>
                  {/* Breakdown por origem quando mostra tudo */}
                  {showProductsBreakdown && revenueSource === 'all' && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                      <span className="flex items-center gap-1"><Scissors className="h-3 w-3" /> {formatMoneyBRLFromCents(servicesRealizedCents)}</span>
                      <span className="flex items-center gap-1"><Package className="h-3 w-3" /> {formatMoneyBRLFromCents(productsDisplayedCents)}</span>
                    </div>
                  )}
                  {/* Breakdown P/B para serviços */}
                  {isMaster && revenueSource !== 'products' && (summary.realizedBarberCents != null || summary.realizedShopCents != null) && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                      <span>P: {formatMoneyBRLFromCents((summary.realizedBarberCents ?? 0) + (revenueSource === 'all' ? productsCommissionCents : 0))}</span>
                      <span>B: {formatMoneyBRLFromCents((summary.realizedShopCents ?? 0) + (revenueSource === 'all' ? productsBarberiaCents : 0))}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex items-center" aria-label="Entenda P e B">
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <div className="space-y-1">
                            <div className="font-medium">Divisão (P/B)</div>
                            <div>P = Profissional (comissão)</div>
                            <div>B = Barbearia</div>
                            <div className="text-muted-foreground">Realizado: soma de Concluído{revenueSource === 'all' ? ' + vendas de produtos' : ''}.</div>
                            <div className="text-muted-foreground">Dono (Sr. Cardoso): P=100%.</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                  {/* Breakdown P/B para apenas produtos */}
                  {isMaster && revenueSource === 'products' && productsRevenueCents > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                      <span>P: {formatMoneyBRLFromCents(productsCommissionCents)}</span>
                      <span>B: {formatMoneyBRLFromCents(productsBarberiaCents)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Projeção</CardTitle>
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMoneyBRLFromCents(displayedProjectionCents)}</div>
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                    <span>{revenueSource === 'products' ? 'Total de vendas' : 'Baseado no histórico'}</span>
                    {revenueSource !== 'products' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="inline-flex items-center" aria-label="Como a projeção é calculada">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <div className="space-y-1">
                          <div className="font-medium">Como calculamos</div>
                          <div>Realizado até hoje + (agendamentos futuros × taxa de comparecimento).</div>
                          <div className="text-muted-foreground">Taxa: últimos 90 dias (Concluído/Falta/Cancelado).</div>
                          {isBarber && pct != null && (
                            <div className="text-muted-foreground">Aplicamos sua comissão ({Math.round(pct * 100)}%).</div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

                </>

              );
            })()}

            {/* Cards de Mix de Serviços e Produtos */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              {/* Mix de Serviços */}
              {revenueSource !== 'products' && (
              <Card className={revenueSource === 'all' ? 'lg:col-span-4' : 'lg:col-span-7'}>
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Scissors className="h-5 w-5" />
                    Mix de Serviços
                  </CardTitle>
                  <CardDescription>Distribuição dos serviços realizados no período.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {(() => {
                      const catalog = (summary.serviceCatalog ?? []).filter((s) => s.active);
                      const known = new Set(catalog.map((s) => s.id));
                      const unknownIds = Object.keys(summary.countsByServiceType || {}).filter((id) => !known.has(id));
                      
                      // Combine for rendering
                      const allServices = [
                        ...catalog.map(s => ({ id: s.id, label: s.label, price: s.priceCents, count: summary.countsByServiceType[s.id] ?? 0 })),
                        ...unknownIds.map(id => ({ id, label: id, price: 0, count: summary.countsByServiceType[id] ?? 0 }))
                      ].filter(s => s.count > 0).sort((a, b) => b.count - a.count);

                      const maxCount = Math.max(...allServices.map(s => s.count), 1);

                      if (allServices.length === 0) {
                        return <div className="text-sm text-muted-foreground">Nenhum serviço registrado.</div>;
                      }

                      return allServices.map((s) => (
                        <div key={s.id} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{s.label}</span>
                            <span className="text-muted-foreground">
                              {s.count} <span className="text-xs mx-1">×</span> {s.price > 0 ? formatMoneyBRLFromCents(s.price) : '-'}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary transition-all duration-500" 
                              style={{ width: `${(s.count / maxCount) * 100}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Mix de Produtos */}
              {(revenueSource === 'products' || revenueSource === 'all') && productsSummary && productsSummary.byProduct.length > 0 && (
              <Card className={revenueSource === 'products' ? 'lg:col-span-4' : 'lg:col-span-3'}>
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Mix de Produtos
                  </CardTitle>
                  <CardDescription>Distribuição dos produtos vendidos no período.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {(() => {
                      const products = productsSummary.byProduct.sort((a, b) => b.quantitySold - a.quantitySold);
                      const maxQty = Math.max(...products.map(p => p.quantitySold), 1);

                      if (products.length === 0) {
                        return <div className="text-sm text-muted-foreground">Nenhum produto vendido.</div>;
                      }

                      return products.slice(0, 8).map((p) => (
                        <div key={p.productId} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium truncate max-w-[60%]">{p.productName}</span>
                            <span className="text-muted-foreground">
                              {p.quantitySold} <span className="text-xs mx-1">×</span> {formatMoneyBRLFromCents(Math.round(p.revenueCents / p.quantitySold))}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-amber-500 transition-all duration-500" 
                              style={{ width: `${(p.quantitySold / maxQty) * 100}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Status */}
              {revenueSource !== 'products' && (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Status dos Agendamentos
                  </CardTitle>
                  <CardDescription>Visão geral dos status.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Object.entries(summary.countsByStatus)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between p-2 rounded-lg border bg-card/50">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize">
                              {formatStatusPtBr(status)}
                            </Badge>
                          </div>
                          <span className="font-bold">{count}</span>
                        </div>
                      ))}
                      {Object.keys(summary.countsByStatus).length === 0 && (
                        <div className="text-sm text-muted-foreground">Nenhum status registrado.</div>
                      )}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Categorias de Produtos (quando visualizando apenas produtos) */}
              {revenueSource === 'products' && productsSummary && productsSummary.byCategory.length > 0 && (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5" />
                    Por Categoria
                  </CardTitle>
                  <CardDescription>Receita por categoria de produto.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {productsSummary.byCategory
                      .sort((a, b) => b.revenueCents - a.revenueCents)
                      .map((cat) => (
                        <div key={cat.categoryId} className="flex items-center justify-between p-2 rounded-lg border bg-card/50">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{cat.categoryName}</span>
                            <Badge variant="secondary" className="text-xs">
                              {cat.itemsSold} {cat.itemsSold === 1 ? 'un' : 'un'}
                            </Badge>
                          </div>
                          <span className="font-bold">{formatMoneyBRLFromCents(cat.revenueCents)}</span>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Formas de Pagamento */}
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    Formas de Pagamento
                  </CardTitle>
                  <CardDescription>Distribuição por forma de pagamento{revenueSource !== 'products' ? ' (apenas concluídos)' : ''}.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {(() => {
                      // Consolidar formas de pagamento de serviços e produtos
                      const methodLabels: Record<string, string> = {
                        credit: 'Cartão de Crédito',
                        debit: 'Cartão de Débito',
                        cash: 'Dinheiro',
                        pix: 'Pix',
                      };
                      const methodIcons: Record<string, string> = {
                        credit: '💳',
                        debit: '💳',
                        cash: '💵',
                        pix: '📱',
                      };

                      // Serviços
                      const servicePayments: Record<string, { count: number; revenueCents: number }> = {};
                      if (revenueSource !== 'products' && summary.countsByPaymentMethod) {
                        Object.entries(summary.countsByPaymentMethod).forEach(([method, count]) => {
                          servicePayments[method] = {
                            count,
                            revenueCents: summary.revenueByPaymentMethod?.[method] ?? 0,
                          };
                        });
                      }

                      // Produtos
                      const productPayments: Record<string, { count: number; revenueCents: number }> = {};
                      if (revenueSource !== 'services' && productsSummary?.byPaymentMethod) {
                        productsSummary.byPaymentMethod.forEach((pm) => {
                          productPayments[pm.method] = {
                            count: pm.count,
                            revenueCents: pm.revenueCents,
                          };
                        });
                      }

                      // Consolidar
                      const allMethods = new Set([...Object.keys(servicePayments), ...Object.keys(productPayments)]);
                      const consolidated: Array<{ method: string; count: number; revenueCents: number }> = [];
                      allMethods.forEach((method) => {
                        const svc = servicePayments[method] ?? { count: 0, revenueCents: 0 };
                        const prd = productPayments[method] ?? { count: 0, revenueCents: 0 };
                        consolidated.push({
                          method,
                          count: svc.count + prd.count,
                          revenueCents: svc.revenueCents + prd.revenueCents,
                        });
                      });

                      const totalCount = consolidated.reduce((a, b) => a + b.count, 0);

                      if (consolidated.length === 0) {
                        return <div className="text-sm text-muted-foreground">Nenhum pagamento registrado.</div>;
                      }

                      return consolidated
                        .sort((a, b) => b.count - a.count)
                        .map(({ method, count, revenueCents }) => {
                          const percentage = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                          return (
                            <div key={method} className="flex items-center justify-between p-3 rounded-lg border bg-card/50">
                              <div className="flex items-center gap-3">
                                <span className="text-xl">{methodIcons[method] ?? '💰'}</span>
                                <div>
                                  <div className="font-medium">{methodLabels[method] ?? method}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatMoneyBRLFromCents(revenueCents)}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-bold">{count}</div>
                                <div className="text-xs text-muted-foreground">{percentage}%</div>
                              </div>
                            </div>
                          );
                        });
                    })()}
                  </div>
                </CardContent>
              </Card>
            </div>

            {isMaster && (
              <Card className="border-primary/20 bg-card/30">
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Configurações (Master)
                  </CardTitle>
                  <CardDescription>Gerencie comissões e catálogo de serviços.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {loadingConfig ? (
                    <div className="flex justify-center py-6">
                      <LoadingSpinner />
                    </div>
                  ) : !configDraft ? (
                    <div className="text-sm text-muted-foreground">Nenhuma configuração carregada.</div>
                  ) : (
                    <>
                      <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Comissão do Profissional (%)</label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              className="font-mono"
                              inputMode="decimal"
                              step="0.01"
                              value={String(Math.round((configDraft.commissions.defaultBarberPct ?? 0) * 10000) / 100)}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                const pct = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0;
                                setConfigDraft({
                                  ...configDraft,
                                  commissions: { ...configDraft.commissions, defaultBarberPct: pct },
                                });
                              }}
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Comissão da Barbearia (%)</label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              className="font-mono"
                              inputMode="decimal"
                              step="0.01"
                              disabled
                              value={String(
                                Math.round(
                                  (Math.max(0, Math.min(1, 1 - (configDraft.commissions.defaultBarberPct ?? 0))) * 10000) /
                                    100
                                )
                              )}
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-medium">Catálogo de Serviços</h3>
                            <p className="text-sm text-muted-foreground">Adicione ou edite os serviços oferecidos.</p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const last = configDraft.services.length
                                ? configDraft.services[configDraft.services.length - 1]
                                : null;
                              const nextSort = ((last?.sortOrder as number | undefined) ?? 0) + 10;
                              setConfigDraft({
                                ...configDraft,
                                services: [
                                  ...configDraft.services,
                                  { id: '', label: '', priceCents: 0, active: true, sortOrder: nextSort },
                                ],
                              });
                            }}
                          >
                            <ArrowUpRight className="mr-2 h-4 w-4" />
                            Novo Serviço
                          </Button>
                        </div>

                        <div className="space-y-3">
                          {configDraft.services.map((s, idx) => (
                            <div key={`${s.id || 'new'}-${idx}`} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center p-3 rounded-lg border bg-background/50">
                              <div className="flex-1 w-full sm:w-auto grid grid-cols-1 sm:grid-cols-12 gap-3">
                                <div className="sm:col-span-3">
                                  <Input
                                    placeholder="ID (ex: barba)"
                                    className="font-mono text-xs"
                                    value={s.id}
                                    onChange={(e) => {
                                      const id = e.target.value;
                                      const next = [...configDraft.services];
                                      next[idx] = { ...next[idx], id };
                                      setConfigDraft({ ...configDraft, services: next });
                                    }}
                                  />
                                </div>
                                <div className="sm:col-span-5">
                                  <Input
                                    placeholder="Nome do Serviço"
                                    value={s.label}
                                    onChange={(e) => {
                                      const label = e.target.value;
                                      const next = [...configDraft.services];
                                      
                                      // Auto-generate ID if it's empty or matches the slug of the previous label
                                      // Simple heuristic: if ID is empty, fill it.
                                      const slug = label.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '_');
                                      
                                      // Only auto-update ID if it was empty or looks like it was auto-generated from the old label
                                      // For simplicity, let's just auto-update if the ID is empty.
                                      // Or better: if the user hasn't manually set a "custom" ID that differs from the slug.
                                      // Let's stick to: if ID is empty, update it.
                                      let newId = next[idx].id;
                                      if (!newId) {
                                        newId = slug;
                                      }
                                      
                                      next[idx] = { ...next[idx], label, id: newId || next[idx].id };
                                      setConfigDraft({ ...configDraft, services: next });
                                    }}
                                  />
                                </div>
                                <div className="sm:col-span-2 relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">R$</span>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    className="pl-8"
                                    value={String((s.priceCents ?? 0) / 100)}
                                    onChange={(e) => {
                                      const v = Number(e.target.value);
                                      const priceCents = Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
                                      const next = [...configDraft.services];
                                      next[idx] = { ...next[idx], priceCents };
                                      setConfigDraft({ ...configDraft, services: next });
                                    }}
                                  />
                                </div>
                                <div className="sm:col-span-2 flex gap-1">
                                  <Button
                                    type="button"
                                    variant={s.active ? 'ghost' : 'destructive'}
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => {
                                      const next = [...configDraft.services];
                                      next[idx] = { ...next[idx], active: !next[idx].active };
                                      setConfigDraft({ ...configDraft, services: next });
                                    }}
                                  >
                                    {s.active ? (
                                      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20">Ativo</Badge>
                                    ) : (
                                      <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20">Inativo</Badge>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      const next = [...configDraft.services];
                                      next.splice(idx, 1);
                                      setConfigDraft({ ...configDraft, services: next });
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end pt-4">
                        <Button
                          type="button"
                          size="lg"
                          disabled={savingConfig}
                          onClick={async () => {
                            if (!configDraft) return;
                            const normalizeId = (v: string) => v.trim().toLowerCase();
                            const idOk = (v: string) => /^[a-z0-9][a-z0-9_-]{0,30}$/.test(v);

                            const services = configDraft.services.map((s) => ({
                              ...s,
                              id: normalizeId(s.id),
                              label: (s.label || '').trim(),
                            }));

                            for (const s of services) {
                              if (!s.id || !idOk(s.id)) {
                                toast({
                                  title: 'Erro',
                                  description: `ID de serviço inválido: "${s.id || '(vazio)'}"`,
                                  variant: 'destructive',
                                });
                                return;
                              }
                              if (!s.label) {
                                toast({
                                  title: 'Erro',
                                  description: `Nome do serviço obrigatório para: "${s.id}"`,
                                  variant: 'destructive',
                                });
                                return;
                              }
                            }

                            const uniq = new Set<string>();
                            for (const s of services) {
                              if (uniq.has(s.id)) {
                                toast({
                                  title: 'Erro',
                                  description: `ID duplicado: "${s.id}"`,
                                  variant: 'destructive',
                                });
                                return;
                              }
                              uniq.add(s.id);
                            }

                            setSavingConfig(true);
                            try {
                              const payload: FinanceConfig = {
                                commissions: {
                                  defaultBarberPct: configDraft.commissions.defaultBarberPct,
                                  ownerBarberPct: configDraft.commissions.ownerBarberPct,
                                },
                                services,
                              };
                              const saved = await api.admin.saveFinanceConfig(payload);
                              setConfigDraft(saved.config);
                              toast({ title: 'Sucesso', description: 'Configurações salvas.' });
                            } catch (error: unknown) {
                              const message = error instanceof Error ? error.message : null;
                              toast({
                                title: 'Erro',
                                description: message || 'Não foi possível salvar as configurações.',
                                variant: 'destructive',
                              });
                            } finally {
                              setSavingConfig(false);
                            }
                          }}
                        >
                          {savingConfig ? 'Salvando alterações...' : 'Salvar Alterações'}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
      </TooltipProvider>
    </AdminLayout>
  );
}
