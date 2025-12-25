import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <h2 className="text-2xl font-serif font-bold">Financeiro</h2>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Select value={selectedBarberId} onValueChange={setSelectedBarberId}>
              <SelectTrigger className="w-full sm:w-[240px]">
                <SelectValue placeholder="Profissional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os profissionais</SelectItem>
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
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : !summary ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Nenhum dado disponível.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="font-serif">Resumo do mês</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Agendamentos</span>
                  <span className="font-medium">{summary.totalBookings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Previsto</span>
                  <span className="font-medium">
                    {formatMoneyBRLFromCents(summary.estimatedRevenueCents ?? 0)}
                  </span>
                </div>
                {(summary.estimatedBarberCents != null || summary.estimatedShopCents != null) && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Previsto (profissional)</span>
                      <span className="font-medium text-foreground">
                        {formatMoneyBRLFromCents(summary.estimatedBarberCents ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Previsto (barbearia)</span>
                      <span className="font-medium text-foreground">
                        {formatMoneyBRLFromCents(summary.estimatedShopCents ?? 0)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Realizado</span>
                  <span className="font-medium">
                    {formatMoneyBRLFromCents(summary.realizedRevenueCents ?? 0)}
                  </span>
                </div>
                {(summary.realizedBarberCents != null || summary.realizedShopCents != null) && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Realizado (profissional)</span>
                      <span className="font-medium text-foreground">
                        {formatMoneyBRLFromCents(summary.realizedBarberCents ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Realizado (barbearia)</span>
                      <span className="font-medium text-foreground">
                        {formatMoneyBRLFromCents(summary.realizedShopCents ?? 0)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Projeção</span>
                  <span className="font-medium">
                    {formatMoneyBRLFromCents(summary.projectionRevenueCents ?? summary.revenueCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="font-medium">{formatMoneyBRLFromCents(summary.revenueCents)}</span>
                </div>
                <div className="pt-2 text-xs text-muted-foreground">
                  Previsto = agendado/confirmado. Realizado = concluído. Projeção usa histórico + taxa de comparecimento.
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="font-serif">Mix de serviços</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const catalog = (summary.serviceCatalog ?? []).filter((s) => s.active);
                  const known = new Set(catalog.map((s) => s.id));
                  const unknownIds = Object.keys(summary.countsByServiceType || {}).filter((id) => !known.has(id));

                  return (
                    <>
                      {catalog.map((s) => (
                        <div key={s.id} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{s.label}</span>
                          <span className="font-medium">
                            {(summary.countsByServiceType[s.id] ?? 0)} × {formatMoneyBRLFromCents(s.priceCents)}
                          </span>
                        </div>
                      ))}
                      {unknownIds.map((id) => (
                        <div key={id} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{id}</span>
                          <span className="font-medium">{summary.countsByServiceType[id] ?? 0}</span>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="font-serif">Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(summary.countsByStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{formatStatusPtBr(status)}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>

            {isMaster && (
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="font-serif">Configurações (Master)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingConfig ? (
                    <div className="flex justify-center py-6">
                      <LoadingSpinner />
                    </div>
                  ) : !configDraft ? (
                    <div className="text-sm text-muted-foreground">Nenhuma configuração carregada.</div>
                  ) : (
                    <>
                      <div className="grid gap-3">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <div className="flex-1">
                            <label className="text-sm text-muted-foreground">Comissão padrão do profissional (%)</label>
                            <Input
                              type="number"
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
                          </div>
                          <div className="flex-1">
                            <label className="text-sm text-muted-foreground">Comissão do Sr. Cardoso (dono) (%)</label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={String(Math.round((configDraft.commissions.ownerBarberPct ?? 0) * 10000) / 100)}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                const pct = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0;
                                setConfigDraft({
                                  ...configDraft,
                                  commissions: { ...configDraft.commissions, ownerBarberPct: pct },
                                });
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Ex.: 45% para barbeiros e 0% para o dono (100% barbearia).
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">Serviços</div>
                          <Button
                            type="button"
                            variant="secondary"
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
                            Adicionar serviço
                          </Button>
                        </div>

                        <div className="space-y-3">
                          {configDraft.services.map((s, idx) => (
                            <div key={`${s.id || 'new'}-${idx}`} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                              <div className="sm:col-span-3">
                                <Input
                                  placeholder="id (ex: cabelo)"
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
                                  placeholder="Nome (ex: Cabelo)"
                                  value={s.label}
                                  onChange={(e) => {
                                    const label = e.target.value;
                                    const next = [...configDraft.services];
                                    next[idx] = { ...next[idx], label };
                                    setConfigDraft({ ...configDraft, services: next });
                                  }}
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  placeholder="Preço"
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
                              <div className="sm:col-span-2 flex gap-2">
                                <Button
                                  type="button"
                                  variant={s.active ? 'secondary' : 'outline'}
                                  className="w-full"
                                  onClick={() => {
                                    const next = [...configDraft.services];
                                    next[idx] = { ...next[idx], active: !next[idx].active };
                                    setConfigDraft({ ...configDraft, services: next });
                                  }}
                                >
                                  {s.active ? 'Ativo' : 'Inativo'}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          O id deve ser minúsculo (a-z, 0-9, _ ou -). Ex.: "sobrancelha" → "sobrancelha".
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <Button
                          type="button"
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
                          {savingConfig ? 'Salvando…' : 'Salvar'}
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
