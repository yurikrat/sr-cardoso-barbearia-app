import { useState, useEffect, useMemo } from 'react';
import {
  ShoppingCart,
  CreditCard,
  Banknote,
  Smartphone,
  Receipt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useToast } from '@/components/ui/use-toast';
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

type Barber = { id: string; name: string };

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

  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleForm, setSaleForm] = useState({
    barberId: '',
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
          propBarbers ? Promise.resolve(null) : api.admin.listBarbers(),
          propProducts ? Promise.resolve(null) : api.admin.listProducts({ activeOnly: true }),
        ]);

        const [barbersResult, productsResult] = results;

        if (!propBarbers && barbersResult.status === 'fulfilled' && barbersResult.value) {
          setBarbers(barbersResult.value.items?.map((b) => ({ id: b.id, name: b.name })) ?? []);
        }

        if (!propProducts && productsResult.status === 'fulfilled' && productsResult.value) {
          setProducts(productsResult.value);
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
        customerName: '',
        paymentMethod: 'pix',
      });
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
                {products.length === 0 ? (
                  <div className="col-span-full text-center py-4 text-muted-foreground">
                    Nenhum produto cadastrado
                  </div>
                ) : (
                  products.map((product) => (
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
          <Button onClick={handleCreateSale} disabled={saving || cart.length === 0 || loading}>
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
  );
}
