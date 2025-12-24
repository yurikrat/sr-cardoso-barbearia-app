import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatDate } from '@/utils/dates';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';

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
      const { items } = await api.admin.listCustomers(100);
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

  const topCustomers = [...customers]
    .sort((a, b) => (b.stats.totalBookings ?? 0) - (a.stats.totalBookings ?? 0))
    .slice(0, 10);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <h2 className="text-2xl font-serif font-bold">Clientes</h2>
          <Input
            placeholder="Buscar por nome ou WhatsApp..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="grid gap-4">
            {!searchTerm && topCustomers.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Top 10 (por agendamentos)</h3>
                    <span className="text-sm text-muted-foreground">Atalho</span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {topCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => navigate(`/admin/clientes/${customer.id}`)}
                        className="w-full text-left rounded-md border p-3 hover:bg-accent transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">
                              {customer.identity.firstName} {customer.identity.lastName}
                            </p>
                            <p className="text-sm text-muted-foreground">{customer.identity.whatsappE164}</p>
                          </div>
                          <span className="text-sm text-muted-foreground">{customer.stats.totalBookings}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {filteredCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  {searchTerm ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
                </CardContent>
              </Card>
            ) : (
              filteredCustomers.map((customer) => (
                <Card
                  key={customer.id}
                  className="cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => navigate(`/admin/clientes/${customer.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {customer.identity.firstName} {customer.identity.lastName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {customer.identity.whatsappE164}
                        </p>
                        <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
                          <span>
                            {customer.stats.totalBookings} agendamento(s)
                          </span>
                          {typeof customer.stats.totalCompleted === 'number' && (
                            <span>
                              {customer.stats.totalCompleted} concluído(s)
                            </span>
                          )}
                          {customer.stats.lastBookingAt && (
                            <span>
                              {(() => {
                                const d = toDateSafe(customer.stats.lastBookingAt);
                                return d ? `Último: ${formatDate(d)}` : null;
                              })()}
                            </span>
                          )}
                          {customer.stats.noShowCount > 0 && (
                            <span className="text-destructive">
                              {customer.stats.noShowCount} falta(s)
                            </span>
                          )}
                        </div>
                      </div>
                      {customer.profile.birthday && (
                        <div className="text-right text-sm">
                          <p className="text-muted-foreground">Aniversário</p>
                          <p className="font-medium">
                            {new Date(customer.profile.birthday).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

