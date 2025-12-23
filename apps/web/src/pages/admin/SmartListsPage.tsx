import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatDate } from '@/utils/dates';
import { DateTime } from 'luxon';
import { useToast } from '@/components/ui/use-toast';
import { generateReactivationMessage, generateBirthdayMessage, generateWhatsAppDeepLink } from '@/utils/whatsapp';

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
    birthdayMmdd?: string;
  };
  consent: {
    marketingOptIn: boolean;
  };
  stats: {
    lastCompletedAt?: FirestoreTimestampLike;
    lastBookingAt?: FirestoreTimestampLike;
    noShowCount: number;
  };
}

export default function SmartListsPage() {
  const { toast } = useToast();
  const [inactiveCustomers, setInactiveCustomers] = useState<Customer[]>([]);
  const [birthdayCustomers, setBirthdayCustomers] = useState<Customer[]>([]);
  const [noShowCustomers, setNoShowCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadLists();
  }, []);

  const loadLists = async () => {
    setLoading(true);
    try {
      const { items } = await api.admin.listCustomers(500);
      const customers = items as Customer[];

      // Inativos 30+ dias
      const thirtyDaysAgo = DateTime.now()
        .setZone('America/Sao_Paulo')
        .minus({ days: 30 })
        .toJSDate();
      
      const inactive: Customer[] = [];
      
      customers.forEach((data) => {
        if (!data.consent?.marketingOptIn) return;
        const lastDate = data.stats.lastCompletedAt?.toDate() || data.stats.lastBookingAt?.toDate();
        if (lastDate && lastDate < thirtyDaysAgo) inactive.push(data);
      });
      
      setInactiveCustomers(inactive);

      // Aniversariantes (próximos 7 dias)
      const today = DateTime.now().setZone('America/Sao_Paulo');
      const birthdayMmddSet = new Set<string>();
      
      for (let i = 0; i < 7; i++) {
        const date = today.plus({ days: i });
        birthdayMmddSet.add(date.toFormat('MMdd'));
      }

      const birthdays: Customer[] = [];
      
      customers.forEach((data) => {
        if (!data.consent?.marketingOptIn) return;
        if (data.profile.birthdayMmdd && birthdayMmddSet.has(data.profile.birthdayMmdd)) birthdays.push(data);
      });
      
      setBirthdayCustomers(birthdays);

      // No-show (ranking)
      const noShows: Customer[] = [];
      
      customers.forEach((data) => {
        if (data.stats.noShowCount > 0) noShows.push(data);
      });
      
      noShows.sort((a, b) => b.stats.noShowCount - a.stats.noShowCount);
      setNoShowCustomers(noShows);
    } catch (error) {
      console.error('Error loading lists:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as listas.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendWhatsApp = (customer: Customer, messageType: 'reactivation' | 'birthday') => {
    const customerName = `${customer.identity.firstName} ${customer.identity.lastName}`;
    
    const message =
      messageType === 'reactivation'
        ? generateReactivationMessage(customerName)
        : generateBirthdayMessage(customer.identity.firstName);
    
    const url = generateWhatsAppDeepLink(customer.identity.whatsappE164, message);
    window.open(url, '_blank');
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold">Listas Inteligentes</h2>

        <Tabs defaultValue="inactive" className="w-full">
          <TabsList>
            <TabsTrigger value="inactive">Inativos 30+ dias</TabsTrigger>
            <TabsTrigger value="birthday">Aniversariantes</TabsTrigger>
            <TabsTrigger value="noshow">No-Show</TabsTrigger>
          </TabsList>

          <TabsContent value="inactive" className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : inactiveCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  Nenhum cliente inativo encontrado.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {inactiveCustomers.map((customer) => (
                  <Card key={customer.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {customer.identity.firstName} {customer.identity.lastName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {customer.identity.whatsappE164}
                        </p>
                        {customer.stats.lastCompletedAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Último atendimento: {formatDate(customer.stats.lastCompletedAt.toDate())}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSendWhatsApp(customer, 'reactivation')}
                      >
                        Enviar WhatsApp
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="birthday" className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : birthdayCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  Nenhum aniversariante nos próximos 7 dias.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {birthdayCustomers.map((customer) => (
                  <Card key={customer.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {customer.identity.firstName} {customer.identity.lastName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {customer.identity.whatsappE164}
                        </p>
                        {customer.profile.birthday && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Aniversário: {new Date(customer.profile.birthday).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSendWhatsApp(customer, 'birthday')}
                      >
                        Enviar WhatsApp
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="noshow" className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : noShowCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  Nenhum cliente com falta registrada.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {noShowCustomers.map((customer) => (
                  <Card key={customer.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">
                            {customer.identity.firstName} {customer.identity.lastName}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {customer.identity.whatsappE164}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-destructive">
                            {customer.stats.noShowCount} falta(s)
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

