import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatDate } from '@/utils/dates';
import { useToast } from '@/components/ui/use-toast';

type FirestoreTimestampLike = { toDate: () => Date };

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
    lastBookingAt?: FirestoreTimestampLike;
    noShowCount: number;
  };
}

export default function CustomersPage() {
  const { toast } = useToast();
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
            {filteredCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  {searchTerm ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
                </CardContent>
              </Card>
            ) : (
              filteredCustomers.map((customer) => (
                <Card key={customer.id} className="cursor-pointer hover:bg-accent transition-colors">
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
                          {customer.stats.lastBookingAt && (
                            <span>
                              Último: {formatDate(customer.stats.lastBookingAt.toDate())}
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

