import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatDate } from '@/utils/dates';
import { DateTime } from 'luxon';
import { useToast } from '@/components/ui/use-toast';
import { 
  generateReactivationMessage, 
  generateBirthdayMessage, 
  generateNoShowMessage,
  generateWhatsAppDeepLink 
} from '@/utils/whatsapp';
import { 
  Search, 
  MessageCircle, 
  UserMinus, 
  Cake, 
  Users,
  Clock,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
    birthdayMmdd?: string;
  };
  consent: {
    marketingOptIn: boolean;
  };
  stats: {
    lastCompletedAt?: TimestampLike;
    lastBookingAt?: TimestampLike;
    noShowCount: number;
    totalBookings: number;
  };
}

export default function SmartListsPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('inactive');

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const { items } = await api.admin.listCustomers(1000);
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

  const lists = useMemo(() => {
    const thirtyDaysAgo = DateTime.now()
      .setZone('America/Sao_Paulo')
      .minus({ days: 30 })
      .toJSDate();
    
    const today = DateTime.now().setZone('America/Sao_Paulo');
    const birthdayMmddSet = new Set<string>();
    for (let i = 0; i < 7; i++) {
      birthdayMmddSet.add(today.plus({ days: i }).toFormat('MMdd'));
    }

    const inactive: Customer[] = [];
    const birthdays: Customer[] = [];
    const noShows: Customer[] = [];

    customers.forEach((c) => {
      // Inativos
      const lastDate = toDateSafe(c.stats.lastCompletedAt) || toDateSafe(c.stats.lastBookingAt);
      if (lastDate && lastDate < thirtyDaysAgo && c.consent?.marketingOptIn) {
        inactive.push(c);
      }

      // Aniversariantes
      if (c.profile.birthdayMmdd && birthdayMmddSet.has(c.profile.birthdayMmdd) && c.consent?.marketingOptIn) {
        birthdays.push(c);
      }

      // No-Show
      if (c.stats.noShowCount > 0) {
        noShows.push(c);
      }
    });

    noShows.sort((a, b) => b.stats.noShowCount - a.stats.noShowCount);

    return { inactive, birthdays, noShows };
  }, [customers]);

  const filteredList = useMemo(() => {
    const currentList = 
      activeTab === 'inactive' ? lists.inactive :
      activeTab === 'birthday' ? lists.birthdays :
      lists.noShows;

    if (!searchTerm) return currentList;
    const search = searchTerm.toLowerCase();
    return currentList.filter(c => 
      c.identity.firstName.toLowerCase().includes(search) ||
      c.identity.lastName.toLowerCase().includes(search) ||
      c.identity.whatsappE164.includes(search)
    );
  }, [activeTab, lists, searchTerm]);

  const handleSendWhatsApp = (customer: Customer, type: 'reactivation' | 'birthday' | 'noshow') => {
    const name = `${customer.identity.firstName} ${customer.identity.lastName}`;
    let message = '';
    
    if (type === 'reactivation') message = generateReactivationMessage(name);
    else if (type === 'birthday') message = generateBirthdayMessage(customer.identity.firstName);
    else if (type === 'noshow') message = generateNoShowMessage(name);
    
    const url = generateWhatsAppDeepLink(customer.identity.whatsappE164, message);
    window.open(url, '_blank');
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-serif font-bold text-foreground">Listas Inteligentes</h2>
            <p className="text-muted-foreground mt-1">Ações rápidas para fidelizar e recuperar clientes.</p>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar na lista..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-card/50 border-primary/10 focus:border-primary/30"
            />
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-card/40 border-primary/10 backdrop-blur-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                <UserMinus className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Inativos (30d+)</p>
                <p className="text-2xl font-bold">{lists.inactive.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-primary/10 backdrop-blur-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-500">
                <Cake className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Aniversariantes (7d)</p>
                <p className="text-2xl font-bold">{lists.birthdays.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-primary/10 backdrop-blur-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">No-Show (Faltas)</p>
                <p className="text-2xl font-bold">{lists.noShows.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 w-full max-w-md bg-card/50 border border-primary/10 p-1 h-12">
            <TabsTrigger value="inactive" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 hidden sm:inline" />
              Inativos
            </TabsTrigger>
            <TabsTrigger value="birthday" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-2">
              <Cake className="h-4 w-4 hidden sm:inline" />
              Aniversários
            </TabsTrigger>
            <TabsTrigger value="noshow" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 hidden sm:inline" />
              No-Show
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <LoadingSpinner />
                <p className="text-sm text-muted-foreground animate-pulse">Carregando listas inteligentes...</p>
              </div>
            ) : filteredList.length === 0 ? (
              <Card className="bg-card/20 border-dashed border-primary/20">
                <CardContent className="p-12 flex flex-col items-center justify-center text-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center text-muted-foreground">
                    <Users className="h-8 w-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium">Nenhum cliente encontrado</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                      Não há clientes que correspondam aos critérios desta lista no momento.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredList.map((customer) => (
                  <Card key={customer.id} className="group bg-card/40 border-primary/5 hover:border-primary/20 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg border border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                            {customer.identity.firstName[0]}{customer.identity.lastName[0]}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg leading-tight">
                              {customer.identity.firstName} {customer.identity.lastName}
                            </h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                              <Badge variant="outline" className="text-[10px] h-5 border-primary/20">
                                {customer.stats.totalBookings || 0} agendamentos
                              </Badge>
                              {activeTab === 'noshow' && (
                                <Badge variant="destructive" className="text-[10px] h-5">
                                  {customer.stats.noShowCount} faltas
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/admin/clientes/${customer.id}`)}
                          className="text-muted-foreground hover:text-primary"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      </div>

                      <div className="mt-6 pt-4 border-t border-primary/5 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          {activeTab === 'inactive' && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>Último: {(() => {
                                const d = toDateSafe(customer.stats.lastCompletedAt) || toDateSafe(customer.stats.lastBookingAt);
                                return d ? formatDate(d) : 'Nunca';
                              })()}</span>
                            </div>
                          )}
                          {activeTab === 'birthday' && (
                            <div className="flex items-center gap-2 text-xs text-pink-500">
                              <Cake className="h-3 w-3" />
                              <span>Aniversário: {customer.profile.birthday ? new Date(customer.profile.birthday).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '--/--'}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <MessageCircle className="h-3 w-3" />
                            <span>{customer.identity.whatsappE164}</span>
                          </div>
                        </div>
                        
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-lg shadow-green-900/20"
                          onClick={() => handleSendWhatsApp(customer, activeTab as any)}
                        >
                          <MessageCircle className="h-4 w-4" />
                          <span className="hidden sm:inline">Enviar WhatsApp</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Tabs>
      </div>
    </AdminLayout>
  );
}


