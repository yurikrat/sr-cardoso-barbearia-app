import { useState, useEffect, useMemo } from 'react';
import { DateTime } from 'luxon';
import {
  ShoppingCart,
  Plus,
  Search,
  Calendar,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Receipt,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useToast } from '@/components/ui/use-toast';
import { useAdminAutoRefreshToken } from '@/contexts/AdminAutoRefreshContext';
import { useAuth } from '@/hooks/useAuth';
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
import { api } from '@/lib/api';

type Product = {
  id: string;
  name: string;
  categoryId: string;
  priceCents: number;
  stockQuantity: number;
  commissionPct: number;
  active: boolean;
};

type Sale = {
  id: string;
  customerId?: string;
  customerName?: string;
  barberId: string;
  barberName?: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    commissionPct: number;
  }>;
  totalCents: number;
  commissionCents: number;
  paymentMethod: 'credit' | 'debit' | 'cash' | 'pix';
  origin: 'standalone' | 'booking';
  dateKey: string;
  createdAt: string;
};

type Barber = { id: string; name: string };

type CartItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  commissionPct: number;
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPaymentMethod(method: string): string {
  switch (method) {
    case 'credit':
      return 'Crédito';
    case 'debit':
      return 'Débito';
    case 'cash':
      return 'Dinheiro';
    case 'pix':
      return 'Pix';
    default:
      return method;
  }
}

const PAYMENT_METHODS = [
  { value: 'pix', label: 'Pix', icon: Smartphone },
  { value: 'credit', label: 'Crédito', icon: CreditCard },
  { value: 'debit', label: 'Débito', icon: CreditCard },
  { value: 'cash', label: 'Dinheiro', icon: Banknote },
] as const;

export default function SalesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const refreshToken = useAdminAutoRefreshToken();
  const isMaster = user?.role === 'master';

  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);

  // Filters
  const [selectedBarberId, setSelectedBarberId] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    DateTime.now().setZone('America/Sao_Paulo').toFormat('yyyy-MM-dd')
  );
  const [searchTerm, setSearchTerm] = useState('');

  // New sale modal
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleForm, setSaleForm] = useState({
    barberId: '',
    customerName: '',
    paymentMethod: 'pix' as 'credit' | 'debit' | 'cash' | 'pix',
  });
  const [saving, setSaving] = useState(false);

  // Effect to set default barber for non-master users
  useEffect(() => {
    if (user?.role === 'barber' && user.barberId) {
      setSelectedBarberId(user.barberId);
      setSaleForm((prev) => ({ ...prev, barberId: user.barberId! }));
    }
  }, [user]);

  // Load data
  const loadData = async () => {
    setLoading(true);
    try {
      const [salesRes, productsRes, barbersRes] = await Promise.all([
        api.admin.listSales({
          dateKey: selectedDate,
          barberId: selectedBarberId !== 'all' ? selectedBarberId : undefined,
        }),
        api.admin.listProducts({ activeOnly: true }),
        api.admin.listBarbers(),
      ]);
      setSales(salesRes);
      setProducts(productsRes);
      setBarbers(barbersRes.items?.map((b) => ({ id: b.id, name: b.name })) ?? []);
    } catch {
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os dados.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, selectedDate, selectedBarberId]);

  // Filtered sales
  const filteredSales = useMemo(() => {
    if (!searchTerm) return sales;
    const lower = searchTerm.toLowerCase();
    return sales.filter(
      (sale) =>
        sale.customerName?.toLowerCase().includes(lower) ||
        sale.barberName?.toLowerCase().includes(lower) ||
        sale.items.some((item) => item.productName.toLowerCase().includes(lower))
    );
  }, [sales, searchTerm]);

  // Totals
  const totals = useMemo(() => {
    return filteredSales.reduce(
      (acc, sale) => ({
        revenue: acc.revenue + sale.totalCents,
        commission: acc.commission + sale.commissionCents,
        count: acc.count + 1,
      }),
      { revenue: 0, commission: 0, count: 0 }
    );
  }, [filteredSales]);

  // Cart total
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  }, [cart]);

  // Open new sale modal
  const openSaleModal = () => {
    setCart([]);
    setSaleForm({
      barberId: user?.role === 'barber' && user.barberId ? user.barberId : barbers[0]?.id || '',
      customerName: '',
      paymentMethod: 'pix',
    });
    setShowSaleModal(true);
  };

  // Add product to cart
  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPriceCents: product.priceCents,
          commissionPct: product.commissionPct,
        },
      ];
    });
  };

  // Update cart item quantity
  const updateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.productId !== productId));
    } else {
      setCart((prev) =>
        prev.map((item) =>
          item.productId === productId ? { ...item, quantity } : item
        )
      );
    }
  };

  // Create sale
  const handleCreateSale = async () => {
    if (cart.length === 0) {
      toast({ title: 'Erro', description: 'Adicione pelo menos um produto.', variant: 'destructive' });
      return;
    }
    if (!saleForm.barberId) {
      toast({ title: 'Erro', description: 'Selecione um barbeiro.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api.admin.createSale({
        barberId: saleForm.barberId,
        customerName: saleForm.customerName || undefined,
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        paymentMethod: saleForm.paymentMethod,
        origin: 'standalone',
      });
      toast({ title: 'Sucesso', description: 'Venda registrada com sucesso!' });
      setShowSaleModal(false);
      await loadData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Não foi possível registrar a venda.';
      toast({
        title: 'Erro',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vendas do dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Faturamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatMoney(totals.revenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Comissões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatMoney(totals.commission)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="mb-2 block">Data</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            {isMaster && (
              <div className="flex-1 min-w-[200px]">
                <Label className="mb-2 block">Barbeiro</Label>
                <Select value={selectedBarberId} onValueChange={setSelectedBarberId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos os barbeiros" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os barbeiros</SelectItem>
                    {barbers.map((barber) => (
                      <SelectItem key={barber.id} value={barber.id}>
                        {barber.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex-1 min-w-[200px]">
              <Label className="mb-2 block">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cliente, barbeiro, produto..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Button onClick={openSaleModal}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Venda
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sales List */}
      <Card>
        <CardHeader>
          <CardTitle>Vendas</CardTitle>
          <CardDescription>
            {filteredSales.length} venda(s) em {DateTime.fromISO(selectedDate).toFormat('dd/MM/yyyy')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma venda encontrada.
              </div>
            ) : (
              filteredSales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {sale.customerName || 'Cliente não identificado'}
                      </span>
                      <Badge variant="outline">
                        {formatPaymentMethod(sale.paymentMethod)}
                      </Badge>
                      {sale.origin === 'booking' && (
                        <Badge variant="secondary">Durante atendimento</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <User className="inline h-3 w-3 mr-1" />
                      {sale.barberName || sale.barberId}
                      <span className="mx-2">•</span>
                      {DateTime.fromISO(sale.createdAt).toFormat('HH:mm')}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {sale.items.map((item, idx) => (
                        <span key={item.productId}>
                          {idx > 0 && ', '}
                          {item.quantity}x {item.productName}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-green-600">{formatMoney(sale.totalCents)}</div>
                    <div className="text-xs text-muted-foreground">
                      Comissão: {formatMoney(sale.commissionCents)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* New Sale Modal */}
      <Dialog open={showSaleModal} onOpenChange={setShowSaleModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Venda</DialogTitle>
            <DialogDescription>
              Registre uma venda de produtos
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Barber and Customer */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Barbeiro *</Label>
                <Select
                  value={saleForm.barberId}
                  onValueChange={(val) => setSaleForm({ ...saleForm, barberId: val })}
                  disabled={!isMaster}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {barbers.map((barber) => (
                      <SelectItem key={barber.id} value={barber.id}>
                        {barber.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Nome do cliente (opcional)</Label>
                <Input
                  value={saleForm.customerName}
                  onChange={(e) => setSaleForm({ ...saleForm, customerName: e.target.value })}
                  placeholder="Nome do cliente"
                />
              </div>
            </div>

            {/* Products */}
            <div>
              <Label className="mb-2 block">Produtos disponíveis</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                {products.map((product) => (
                  <Button
                    key={product.id}
                    variant="outline"
                    className="justify-start h-auto py-2 px-3"
                    onClick={() => addToCart(product)}
                    disabled={product.stockQuantity <= 0}
                  >
                    <div className="text-left">
                      <div className="font-medium text-sm">{product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatMoney(product.priceCents)}
                        {product.stockQuantity <= 0 && (
                          <span className="text-destructive ml-1">(Sem estoque)</span>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            {/* Cart */}
            <div>
              <Label className="mb-2 block">
                <ShoppingCart className="inline h-4 w-4 mr-1" />
                Carrinho
              </Label>
              {cart.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground border rounded-lg">
                  Nenhum produto adicionado
                </div>
              ) : (
                <div className="space-y-2 border rounded-lg p-2">
                  {cart.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded"
                    >
                      <div>
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-sm text-muted-foreground">
                          {formatMoney(item.unitPriceCents)} cada
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateCartQuantity(item.productId, item.quantity - 1)}
                        >
                          -
                        </Button>
                        <span className="w-8 text-center">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateCartQuantity(item.productId, item.quantity + 1)}
                        >
                          +
                        </Button>
                        <div className="w-24 text-right font-medium">
                          {formatMoney(item.unitPriceCents * item.quantity)}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t font-bold">
                    <span>Total</span>
                    <span className="text-green-600">{formatMoney(cartTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Method */}
            <div>
              <Label className="mb-2 block">Forma de pagamento</Label>
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant={saleForm.paymentMethod === value ? 'default' : 'outline'}
                    className="flex flex-col h-auto py-3"
                    onClick={() => setSaleForm({ ...saleForm, paymentMethod: value })}
                  >
                    <Icon className="h-5 w-5 mb-1" />
                    <span className="text-xs">{label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaleModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateSale} disabled={saving || cart.length === 0}>
              {saving ? (
                <LoadingSpinner />
              ) : (
                <>
                  <Receipt className="h-4 w-4 mr-2" />
                  Finalizar Venda ({formatMoney(cartTotal)})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
