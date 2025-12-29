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
  Trash2
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
  const isMaster = user?.role === 'master';

  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<string>('all');

  // Sincroniza o barbeiro selecionado com o perfil do usuário se não for master
  useEffect(() => {
    if (user && user.role === 'barber' && user.barberId) {
      setSelectedBarberId(user.barberId);
    }
  }, [user]);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    return now.toFormat('yyyy-MM');
  });
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
    serviceCatalog?: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>;
    commissions?: { defaultBarberPct: number; ownerBarberPct: number };
  }>(null);

  type FinanceConfig = {
    commissions: { defaultBarberPct: number; ownerBarberPct: number };
    services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>;
  };

  const [configDraft, setConfigDraft] = useState<FinanceConfig | null>(null);

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
  }, []);

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
  }, [isMaster, toast]);

  const monthOptions = useMemo(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo').startOf('month');
    return Array.from({ length: 12 }, (_, i) => now.minus({ months: i })).map((dt) => ({
      value: dt.toFormat('yyyy-MM'),
      label: dt.toFormat('LLLL yyyy', { locale: 'pt-BR' }),
    }));
  }, []);

  const { startDateKey, endDateKey } = useMemo(() => {
    const start = DateTime.fromFormat(selectedMonth, 'yyyy-MM', { zone: 'America/Sao_Paulo' }).startOf('month');
    const end = start.endOf('month');
    return { startDateKey: start.toFormat('yyyy-MM-dd'), endDateKey: end.toFormat('yyyy-MM-dd') };
  }, [selectedMonth]);

  const handleExport = async () => {
    if (!summary) return;

    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();

    // Sheet 1: Resumo
    const wsSummary = workbook.addWorksheet('Resumo');
    wsSummary.columns = [
      { header: 'Métrica', key: 'metric', width: 30 },
      { header: 'Valor', key: 'value', width: 20 },
    ];
    wsSummary.addRows([
      ['Mês', selectedMonth],
      ['Agendamentos', summary.totalBookings],
      ['Previsto', (summary.estimatedRevenueCents ?? 0) / 100],
      ['Realizado', (summary.realizedRevenueCents ?? 0) / 100],
      ['Projeção', (summary.projectionRevenueCents ?? summary.revenueCents ?? 0) / 100],
      ['Total', (summary.revenueCents ?? 0) / 100],
      [],
      ['Previsto (Profissional)', (summary.estimatedBarberCents ?? 0) / 100],
      ['Previsto (Barbearia)', (summary.estimatedShopCents ?? 0) / 100],
      ['Realizado (Profissional)', (summary.realizedBarberCents ?? 0) / 100],
      ['Realizado (Barbearia)', (summary.realizedShopCents ?? 0) / 100],
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

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro_${selectedMonth}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const barberId = selectedBarberId === 'all' ? null : selectedBarberId;
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
          serviceCatalog: data.serviceCatalog,
          commissions: data.commissions,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : null;
        toast({
          title: 'Erro',
          description: message || 'Não foi possível carregar o financeiro.',
          variant: 'destructive',
        });
        setSummary(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [startDateKey, endDateKey, selectedBarberId, toast]);

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h2 className="text-3xl font-serif font-bold tracking-tight">Financeiro</h2>
            <p className="text-muted-foreground">Acompanhe o desempenho da barbearia.</p>
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

            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Qual mês?" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
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
            {/* KPI Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Agendamentos</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.totalBookings}</div>
                  <p className="text-xs text-muted-foreground">
                    Total no mês
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Previsto</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMoneyBRLFromCents(summary.estimatedRevenueCents ?? 0)}</div>
                  {(summary.estimatedBarberCents != null || summary.estimatedShopCents != null) && (
                    <div className="mt-1 text-xs text-muted-foreground flex gap-2">
                      <span title="Profissional">P: {formatMoneyBRLFromCents(summary.estimatedBarberCents ?? 0)}</span>
                      <span title="Barbearia">B: {formatMoneyBRLFromCents(summary.estimatedShopCents ?? 0)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Realizado</CardTitle>
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatMoneyBRLFromCents(summary.realizedRevenueCents ?? 0)}</div>
                  {(summary.realizedBarberCents != null || summary.realizedShopCents != null) && (
                    <div className="mt-1 text-xs text-muted-foreground flex gap-2">
                      <span title="Profissional">P: {formatMoneyBRLFromCents(summary.realizedBarberCents ?? 0)}</span>
                      <span title="Barbearia">B: {formatMoneyBRLFromCents(summary.realizedShopCents ?? 0)}</span>
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
                  <div className="text-2xl font-bold">{formatMoneyBRLFromCents(summary.projectionRevenueCents ?? summary.revenueCents)}</div>
                  <p className="text-xs text-muted-foreground">
                    Baseado no histórico
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              {/* Mix de Serviços */}
              <Card className="lg:col-span-4">
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

              {/* Status */}
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
                          <label className="text-sm font-medium">Comissão da Barbearia (Sr. Cardoso) (%)</label>
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
    </AdminLayout>
  );
}
