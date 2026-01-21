import { useState, useEffect, useMemo } from 'react';
import {
  ShoppingCart,
  CreditCard,
  Banknote,
  Smartphone,
  Receipt,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { formatPhoneForDisplay } from '@/utils/phone';
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

type Barber = { id: string; name: string };

type CustomerOption = {
  id: string;
  name: string;
  whatsappE164?: string;
};

type CartItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  commissionPct: number;
};

const PAYMENT_METHODS = [
  { value: 'pix', label: 'Pix', icon: Smartphone },
  { value: 'credit', label: 'Crédito', icon: CreditCard },
  { value: 'debit', label: 'Débito', icon: CreditCard },
  { value: 'cash', label: 'Dinheiro', icon: Banknote },
] as const;

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface SaleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Pré-selecionar barbeiro */
  defaultBarberId?: string;
  /** Lista de barbeiros disponíveis (se não fornecida, carrega da API) */
  barbers?: Barber[];
  /** Lista de produtos disponíveis (se não fornecida, carrega da API) */
  products?: Product[];
}

export function SaleModal({
  open,
  onOpenChange,
  onSuccess,
  defaultBarberId,
  barbers: propBarbers,
  products: propProducts,
}: SaleModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isMaster = user?.role === 'master';

  const [loading, setLoading] = useState(false);
  const [barbers, setBarbers] = useState<Barber[]>(propBarbers ?? []);
  const [products, setProducts] = useState<Product[]>(propProducts ?? []);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountInput, setDiscountInput] = useState('');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleForm, setSaleForm] = useState({
    barberId: '',
    customerId: '',
    customerName: '',
    paymentMethod: 'pix' as 'credit' | 'debit' | 'cash' | 'pix',
  });
  const [saving, setSaving] = useState(false);

  // Carregar dados se não forem fornecidos como props
  useEffect(() => {
    if (!open) return;
    
    const loadData = async () => {
      setLoading(true);
      try {
        const results = await Promise.allSettled([
          api.admin.listBarbers(),
          propProducts ? Promise.resolve(null) : api.admin.listProducts({ activeOnly: true }),
          api.admin.listCustomers(200),
        ]);

        const [barbersResult, productsResult, customersResult] = results;

        if (barbersResult.status === 'fulfilled' && barbersResult.value) {
          setBarbers(barbersResult.value.items?.map((b) => ({ id: b.id, name: b.name })) ?? []);
        }

        if (!propProducts && productsResult.status === 'fulfilled' && productsResult.value) {
          setProducts(productsResult.value);
        }

        if (customersResult.status === 'fulfilled' && customersResult.value) {
          const items = customersResult.value.items ?? [];
          const mapped = items
            .map((raw) => {
              if (!raw || typeof raw !== 'object') return null;
              const data = raw as Record<string, unknown>;
              const id = String(data.id ?? '');
              if (!id) return null;
              const identity = data.identity && typeof data.identity === 'object' ? (data.identity as Record<string, unknown>) : {};
              const firstName = typeof identity.firstName === 'string' ? identity.firstName : '';
              const lastName = typeof identity.lastName === 'string' ? identity.lastName : '';
              const name = `${firstName} ${lastName}`.trim() || 'Cliente sem nome';
              const whatsappE164 = typeof identity.whatsappE164 === 'string' ? identity.whatsappE164 : undefined;
              return { id, name, whatsappE164 } as CustomerOption;
            })
            .filter((item): item is CustomerOption => item !== null);
          setCustomers(mapped);
        }
      } catch (e) {
        console.error('Erro ao carregar dados:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [open, propBarbers, propProducts]);

  // Reset form quando abrir
  useEffect(() => {
    if (open) {
      setCart([]);
      const barberId = defaultBarberId ?? (user?.role === 'barber' && user.barberId ? user.barberId : '');
      setSaleForm({
        barberId,
        customerId: '',
        customerName: '',
        paymentMethod: 'pix',
      });
      setCustomerQuery('');
      setProductQuery('');
      setDiscountEnabled(false);
      setDiscountInput('');
    }
  }, [open, defaultBarberId, user]);

  // Set default barber quando barbers carregar
  useEffect(() => {
    if (barbers.length > 0 && !saleForm.barberId) {
      const defaultId = defaultBarberId ?? (user?.role === 'barber' && user.barberId ? user.barberId : barbers[0]?.id);
      if (defaultId) {
        setSaleForm((prev) => ({ ...prev, barberId: defaultId }));
      }
    }
  }, [barbers, defaultBarberId, user, saleForm.barberId]);

  // Cart total
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  }, [cart]);

  const parseDiscountCents = (input: string) => {
    const cleaned = input.replace(/\s/g, '').replace(/[^0-9,]/g, '').replace(',', '.');
    if (!cleaned) return 0;
    const value = Number.parseFloat(cleaned);
    if (Number.isNaN(value) || value <= 0) return 0;
    return Math.round(value * 100);
  };

  const discountCents = discountEnabled ? parseDiscountCents(discountInput) : 0;
  const finalTotal = Math.max(0, cartTotal - discountCents);

  const filteredCustomers = useMemo(() => {
    if (!customerQuery.trim()) return customers;
    const q = customerQuery.toLowerCase();
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.whatsappE164 ?? '').toLowerCase().includes(q)
    );
  }, [customers, customerQuery]);

  const filteredProducts = useMemo(() => {
    if (!productQuery.trim()) return products;
    const q = productQuery.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, productQuery]);

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
        customerId: saleForm.customerId || undefined,
        customerName: saleForm.customerName || undefined,
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        paymentMethod: saleForm.paymentMethod,
        discountCents: discountCents > 0 ? discountCents : undefined,
        origin: 'standalone',
      });
      toast({ title: 'Sucesso', description: 'Venda registrada com sucesso!' });
      onOpenChange(false);
      onSuccess?.();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Venda</DialogTitle>
          <DialogDescription>
            Registre uma venda de produtos
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : (
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
                {!isMaster && saleForm.barberId ? (
                  <div className="text-xs text-muted-foreground">
                    Barbeiro definido pela sua conta.
                  </div>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label>Cliente (opcional)</Label>
                <Select
                  value={saleForm.customerId || 'none'}
                  onValueChange={(val) => {
                    if (val === 'none') {
                      setSaleForm({ ...saleForm, customerId: '', customerName: '' });
                      return;
                    }
                    const selected = customers.find((c) => c.id === val);
                    setSaleForm({
                      ...saleForm,
                      customerId: val,
                      customerName: selected?.name ?? saleForm.customerName,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Buscar cliente..."
                        value={customerQuery}
                        onChange={(e) => setCustomerQuery(e.target.value)}
                      />
                    </div>
                    <SelectItem value="none">Sem cliente</SelectItem>
                    {filteredCustomers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                        {customer.whatsappE164 ? ` • ${formatPhoneForDisplay(customer.whatsappE164)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={saleForm.customerName}
                  onChange={(e) =>
                    setSaleForm({
                      ...saleForm,
                      customerName: e.target.value,
                      customerId: '',
                    })
                  }
                  placeholder="Nome do cliente"
                />
              </div>
            </div>

            {/* Products */}
            <div>
              <Label className="mb-2 block">Produtos disponíveis</Label>
              <div className="mb-2 relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar produto..."
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                {filteredProducts.length === 0 ? (
                  <div className="col-span-full text-center py-4 text-muted-foreground">
                    Nenhum produto encontrado
                  </div>
                ) : (
                  filteredProducts.map((product) => (
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
                  ))
                )}
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

            {/* Discount */}
            <div>
              <Label className="mb-2 block">Desconto</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant={discountEnabled ? 'default' : 'outline'}
                  onClick={() => setDiscountEnabled((prev) => !prev)}
                >
                  {discountEnabled ? 'Com desconto' : 'Aplicar desconto'}
                </Button>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 10,00"
                  className="w-32"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  disabled={!discountEnabled}
                />
                <span className="text-sm text-muted-foreground">R$</span>
              </div>
              {discountEnabled && discountCents > cartTotal && (
                <div className="text-xs text-destructive mt-1">
                  Desconto não pode ser maior que o total.
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
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreateSale} disabled={saving || cart.length === 0 || loading || (discountEnabled && discountCents > cartTotal)}>
            {saving ? (
              <LoadingSpinner />
            ) : (
              <>
                <Receipt className="h-4 w-4 mr-2" />
                Finalizar Venda ({formatMoney(finalTotal)})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
