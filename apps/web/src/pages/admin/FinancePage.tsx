import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    return now.toFormat('yyyy-MM');
  });
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<null | {
    totalBookings: number;
    revenueCents: number;
    estimatedRevenueCents?: number;
    realizedRevenueCents?: number;
    projectionRevenueCents?: number | null;
    countsByServiceType: Record<string, number>;
    countsByStatus: Record<string, number>;
    pricingCents: { cabelo: number; barba: number; cabelo_barba: number };
  }>(null);

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
          projectionRevenueCents: data.projectionRevenueCents,
          countsByServiceType: data.countsByServiceType,
          countsByStatus: data.countsByStatus,
          pricingCents: data.pricingCents,
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
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Realizado</span>
                  <span className="font-medium">
                    {formatMoneyBRLFromCents(summary.realizedRevenueCents ?? 0)}
                  </span>
                </div>
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
                {(['cabelo', 'barba', 'cabelo_barba'] as const).map((k) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {k === 'cabelo' ? 'Cabelo' : k === 'barba' ? 'Barba' : 'Cabelo + Barba'}
                    </span>
                    <span className="font-medium">
                      {(summary.countsByServiceType[k] ?? 0)} × {formatMoneyBRLFromCents(summary.pricingCents[k])}
                    </span>
                  </div>
                ))}
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
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
