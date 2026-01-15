import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package,
  Plus,
  Edit2,
  Trash2,
  Search,
  AlertTriangle,
  Layers,
  Settings,
  ChevronRight,
  Archive,
  ArrowUpDown,
  ShoppingBag,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { SaleModal } from '@/components/admin/SaleModal';
import type { ProductsConfig } from '@sr-cardoso/shared';

// Tipos locais que refletem o que a API retorna (datas como string ISO)
type ApiProduct = Awaited<ReturnType<typeof api.admin.listProducts>>[number];
type ApiProductCategory = Awaited<ReturnType<typeof api.admin.listProductCategories>>[number];
type ApiStockMovement = Awaited<ReturnType<typeof api.admin.listStockMovements>>[number];
type ApiStockAlert = Awaited<ReturnType<typeof api.admin.getStockAlerts>>[number];

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(pct: number): string {
  return `${(pct * 100).toFixed(0)}%`;
}

export default function ProductsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const refreshToken = useAdminAutoRefreshToken();
  const navigate = useNavigate();
  const isMaster = user?.role === 'master';

  const [activeTab, setActiveTab] = useState('products');
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [categories, setCategories] = useState<ApiProductCategory[]>([]);
  const [stockAlerts, setStockAlerts] = useState<ApiStockAlert[]>([]);
  const [stockMovements, setStockMovements] = useState<ApiStockMovement[]>([]);
  const [config, setConfig] = useState<ProductsConfig | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Modal states
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ApiProduct | null>(null);
  const [editingCategory, setEditingCategory] = useState<ApiProductCategory | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ApiProduct | null>(null);
  const [stockProduct, setStockProduct] = useState<ApiProduct | null>(null);

  // Form states - usando strings para inputs numéricos para melhor UX
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    categoryId: '',
    priceStr: '',
    costStr: '',
    stockStr: '',
    minStockStr: '',
    commissionStr: '',
    active: true,
  });
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    sortOrder: 0,
    active: true,
  });
  const [stockForm, setStockForm] = useState({
    type: 'in' as 'in' | 'out' | 'adjustment',
    quantity: 0,
    reason: '',
  });
  const [configForm, setConfigForm] = useState({
    defaultCommissionPct: 0.1,
    lowStockAlertEnabled: true,
    lowStockWhatsappEnabled: true,
    blockSaleOnZeroStock: false,
  });
  const [saving, setSaving] = useState(false);

  // Load data
  const loadData = async () => {
    setLoading(true);
    try {
      // Carregar dados com tratamento de erro individual usando Promise.allSettled
      const results = await Promise.allSettled([
        api.admin.listProducts(),
        api.admin.listProductCategories(),
        api.admin.getStockAlerts(),
        api.admin.listStockMovements({ limit: 50 }),
        api.admin.getProductsConfig(),
      ]);

      const [productsResult, categoriesResult, alertsResult, movementsResult, configResult] = results;

      // Processar resultados individualmente
      if (productsResult.status === 'fulfilled') {
        setProducts(productsResult.value);
      } else {
        console.error('Erro ao carregar produtos:', productsResult.reason);
      }

      if (categoriesResult.status === 'fulfilled') {
        setCategories(categoriesResult.value);
      } else {
        console.error('Erro ao carregar categorias:', categoriesResult.reason);
      }

      if (alertsResult.status === 'fulfilled') {
        setStockAlerts(alertsResult.value);
      } else {
        console.error('Erro ao carregar alertas:', alertsResult.reason);
      }

      if (movementsResult.status === 'fulfilled') {
        setStockMovements(movementsResult.value);
      } else {
        console.error('Erro ao carregar movimentações:', movementsResult.reason);
      }

      if (configResult.status === 'fulfilled') {
        const configRes = configResult.value;
        setConfig(configRes);
        setConfigForm({
          defaultCommissionPct: configRes.defaultCommissionPct,
          lowStockAlertEnabled: configRes.lowStockAlertEnabled,
          lowStockWhatsappEnabled: configRes.lowStockWhatsappEnabled,
          blockSaleOnZeroStock: configRes.blockSaleOnZeroStock,
        });
      } else {
        console.error('Erro ao carregar config:', configResult.reason);
      }

      // Mostrar erro apenas se TODAS as chamadas falharam
      const allFailed = results.every((r) => r.status === 'rejected');
      if (allFailed) {
        toast({
          title: 'Erro',
          description: 'Não foi possível carregar os dados de produtos. Verifique sua conexão.',
          variant: 'destructive',
        });
      }
    } catch (e) {
      console.error('Erro inesperado ao carregar dados:', e);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os dados de produtos.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        searchTerm === '' ||
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.description?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory =
        selectedCategory === 'all' || product.categoryId === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  // Category map for display
  const categoryMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c.name]));
  }, [categories]);

  // Open product modal for create/edit
  const openProductModal = (product?: ApiProduct) => {
    if (product) {
      setEditingProduct(product);
      setProductForm({
        name: product.name,
        description: product.description || '',
        categoryId: product.categoryId,
        priceStr: (product.priceCents / 100).toFixed(2).replace('.', ','),
        costStr: product.costCents ? (product.costCents / 100).toFixed(2).replace('.', ',') : '',
        stockStr: String(product.stockQuantity),
        minStockStr: String(product.minStockAlert),
        commissionStr: String(Math.round(product.commissionPct * 100)),
        active: product.active,
      });
    } else {
      setEditingProduct(null);
      const defaultCommission = config?.defaultCommissionPct ?? 0.1;
      setProductForm({
        name: '',
        description: '',
        categoryId: categories[0]?.id || '',
        priceStr: '',
        costStr: '',
        stockStr: '',
        minStockStr: '',
        commissionStr: String(Math.round(defaultCommission * 100)),
        active: true,
      });
    }
    setShowProductModal(true);
  };

  // Save product
  const handleSaveProduct = async () => {
    if (!productForm.name || !productForm.categoryId) {
      toast({ title: 'Erro', description: 'Nome e categoria são obrigatórios.', variant: 'destructive' });
      return;
    }
    if (!isMaster) {
      toast({ title: 'Acesso negado', description: 'Apenas administradores podem gerenciar produtos.', variant: 'destructive' });
      return;
    }
    // Converter strings para números (aceita vírgula como decimal)
    const priceCents = Math.round(parseFloat(productForm.priceStr.replace(',', '.') || '0') * 100);
    const costCents = Math.round(parseFloat(productForm.costStr.replace(',', '.') || '0') * 100);
    const stockQuantity = parseInt(productForm.stockStr || '0', 10);
    const minStockAlert = parseInt(productForm.minStockStr || '0', 10);
    const commissionPct = parseInt(productForm.commissionStr || '0', 10) / 100;
    
    if (priceCents <= 0) {
      toast({ title: 'Erro', description: 'Preço de venda deve ser maior que zero.', variant: 'destructive' });
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        name: productForm.name,
        description: productForm.description || undefined,
        categoryId: productForm.categoryId,
        priceCents,
        costCents: costCents || undefined,
        stockQuantity,
        minStockAlert,
        commissionPct,
        active: productForm.active,
      };
      if (editingProduct) {
        await api.admin.updateProduct(editingProduct.id, payload);
        toast({ title: 'Sucesso', description: 'Produto atualizado.' });
      } else {
        await api.admin.createProduct(payload);
        toast({ title: 'Sucesso', description: 'Produto criado.' });
      }
      setShowProductModal(false);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar o produto.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Delete product
  const handleDeleteProduct = async () => {
    if (!deletingProduct) return;
    setSaving(true);
    try {
      await api.admin.deleteProduct(deletingProduct.id);
      toast({ title: 'Sucesso', description: 'Produto excluído.' });
      setShowDeleteDialog(false);
      setDeletingProduct(null);
      await loadData();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível excluir o produto.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Open category modal for create/edit
  const openCategoryModal = (category?: ApiProductCategory) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({
        name: category.name,
        sortOrder: category.sortOrder,
        active: category.active,
      });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', sortOrder: 0, active: true });
    }
    setShowCategoryModal(true);
  };

  // Save category
  const handleSaveCategory = async () => {
    if (!categoryForm.name) {
      toast({ title: 'Erro', description: 'Nome é obrigatório.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editingCategory) {
        await api.admin.updateProductCategory(editingCategory.id, categoryForm);
        toast({ title: 'Sucesso', description: 'Categoria atualizada.' });
      } else {
        await api.admin.createProductCategory(categoryForm);
        toast({ title: 'Sucesso', description: 'Categoria criada.' });
      }
      setShowCategoryModal(false);
      await loadData();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível salvar a categoria.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Open stock modal
  const openStockModal = (product: ApiProduct) => {
    setStockProduct(product);
    setStockForm({ type: 'in', quantity: 0, reason: '' });
    setShowStockModal(true);
  };

  // Save stock movement
  const handleSaveStock = async () => {
    if (!stockProduct || stockForm.quantity === 0 || !stockForm.reason) {
      toast({ title: 'Erro', description: 'Quantidade e motivo são obrigatórios.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api.admin.createStockMovement({
        productId: stockProduct.id,
        type: stockForm.type,
        quantity: stockForm.quantity,
        reason: stockForm.reason,
      });
      toast({ title: 'Sucesso', description: 'Movimentação registrada.' });
      setShowStockModal(false);
      await loadData();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível registrar a movimentação.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Save config
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await api.admin.updateProductsConfig(configForm);
      toast({ title: 'Sucesso', description: 'Configurações atualizadas.' });
      setShowConfigModal(false);
      await loadData();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível salvar as configurações.', variant: 'destructive' });
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
      {/* Alerts banner */}
      {stockAlerts.length > 0 && (
        <Card className="mb-4 border-orange-500 bg-orange-50">
          <CardContent className="py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              <span className="font-medium text-orange-800">
                {stockAlerts.length} produto(s) com estoque baixo ou zerado
              </span>
              <Button
                variant="link"
                className="text-orange-700 p-0 h-auto"
                onClick={() => setActiveTab('alerts')}
              >
                Ver alertas <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="products">
              <Package className="h-4 w-4 mr-2" />
              Produtos
            </TabsTrigger>
            <TabsTrigger value="categories">
              <Layers className="h-4 w-4 mr-2" />
              Categorias
            </TabsTrigger>
            <TabsTrigger value="movements">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              Movimentações
            </TabsTrigger>
            <TabsTrigger value="alerts">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Alertas
              {stockAlerts.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {stockAlerts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            {isMaster && (
              <Button variant="outline" onClick={() => setShowConfigModal(true)}>
                <Settings className="h-4 w-4 mr-2" />
                Configurações
              </Button>
            )}
          </div>
        </div>

        {/* Products Tab */}
        <TabsContent value="products">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Produtos</CardTitle>
                  <CardDescription>
                    {filteredProducts.length} produto(s) cadastrado(s)
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowSaleModal(true)}>
                    <ShoppingBag className="h-4 w-4 mr-2" />
                    Nova Venda
                  </Button>
                  {isMaster && (
                    <Button onClick={() => openProductModal()}>
                      <Plus className="h-4 w-4 mr-2" />
                      Novo Produto
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produtos..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum produto encontrado.
                  </div>
                ) : (
                  filteredProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{product.name}</span>
                          {!product.active && (
                            <Badge variant="secondary">Inativo</Badge>
                          )}
                          {product.stockQuantity === 0 && (
                            <Badge variant="destructive">Sem estoque</Badge>
                          )}
                          {product.stockQuantity > 0 &&
                            product.stockQuantity <= product.minStockAlert && (
                              <Badge variant="outline" className="border-orange-500 text-orange-600">
                                Estoque baixo
                              </Badge>
                            )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {categoryMap.get(product.categoryId) || 'Sem categoria'} •{' '}
                          {formatMoney(product.priceCents)} •{' '}
                          Estoque: {product.stockQuantity} •{' '}
                          Comissão: {formatPercent(product.commissionPct)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigate(`/admin/financeiro?productId=${product.id}&productName=${encodeURIComponent(product.name)}`);
                          }}
                          title="Ver vendas deste produto"
                        >
                          <ShoppingBag className="h-4 w-4 mr-1" />
                          Vendas
                        </Button>
                        {isMaster && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openStockModal(product)}
                          >
                            <Archive className="h-4 w-4 mr-1" />
                            Estoque
                          </Button>
                        )}
                        {isMaster && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openProductModal(product)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setDeletingProduct(product);
                                setShowDeleteDialog(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Categorias</CardTitle>
                  <CardDescription>
                    Organize seus produtos em categorias
                  </CardDescription>
                </div>
                {isMaster && (
                  <Button onClick={() => openCategoryModal()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Nova Categoria
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {categories.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma categoria cadastrada.
                  </div>
                ) : (
                  categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{category.name}</span>
                          {!category.active && (
                            <Badge variant="secondary">Inativa</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {products.filter((p) => p.categoryId === category.id).length} produto(s)
                        </div>
                      </div>
                      {isMaster && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openCategoryModal(category)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Movements Tab */}
        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Movimentações de Estoque</CardTitle>
              <CardDescription>
                Histórico recente de entradas, saídas e ajustes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stockMovements.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma movimentação registrada.
                  </div>
                ) : (
                  stockMovements.map((movement) => (
                    <div
                      key={movement.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{movement.productName}</span>
                          <Badge
                            variant={
                              movement.type === 'in'
                                ? 'default'
                                : movement.type === 'out' || movement.type === 'sale'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {movement.type === 'in'
                              ? 'Entrada'
                              : movement.type === 'out'
                              ? 'Saída'
                              : movement.type === 'sale'
                              ? 'Venda'
                              : 'Ajuste'}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {movement.reason} • {movement.previousQuantity} → {movement.newQuantity}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-medium ${
                            movement.quantity > 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {movement.quantity > 0 ? '+' : ''}
                          {movement.quantity}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(movement.createdAt).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Alertas de Estoque</CardTitle>
              <CardDescription>
                Produtos com estoque baixo ou zerado
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stockAlerts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum alerta de estoque no momento.
                  </div>
                ) : (
                  stockAlerts.map((alert) => (
                    <div
                      key={alert.productId}
                      className={`flex items-center justify-between p-4 border rounded-lg ${
                        alert.status === 'out' ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <AlertTriangle
                            className={`h-4 w-4 ${
                              alert.status === 'out' ? 'text-red-600' : 'text-orange-600'
                            }`}
                          />
                          <span className="font-medium">{alert.productName}</span>
                          <Badge
                            variant={alert.status === 'out' ? 'destructive' : 'outline'}
                            className={alert.status === 'low' ? 'border-orange-500 text-orange-600' : ''}
                          >
                            {alert.status === 'out' ? 'Sem estoque' : 'Estoque baixo'}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {alert.categoryName} • Atual: {alert.currentStock} • Mínimo: {alert.minStock}
                        </div>
                      </div>
                      {isMaster && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const product = products.find((p) => p.id === alert.productId);
                            if (product) openStockModal(product);
                          }}
                        >
                          Repor estoque
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Product Modal */}
      <Dialog open={showProductModal} onOpenChange={setShowProductModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? 'Editar Produto' : 'Novo Produto'}
            </DialogTitle>
            <DialogDescription>
              {editingProduct
                ? 'Atualize as informações do produto.'
                : 'Preencha os dados do novo produto.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                placeholder="Nome do produto"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                value={productForm.description}
                onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                placeholder="Descrição opcional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">Categoria *</Label>
              <Select
                value={productForm.categoryId}
                onValueChange={(val) => setProductForm({ ...productForm, categoryId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">Preço de venda (R$) *</Label>
                <Input
                  id="price"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={productForm.priceStr}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      priceStr: e.target.value.replace(/[^0-9,.]/g, ''),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cost">Custo (R$)</Label>
                <Input
                  id="cost"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={productForm.costStr}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      costStr: e.target.value.replace(/[^0-9,.]/g, ''),
                    })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="stock">Estoque inicial</Label>
                <Input
                  id="stock"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={productForm.stockStr}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      stockStr: e.target.value.replace(/[^0-9]/g, ''),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="minStock">Alerta de estoque mínimo</Label>
                <Input
                  id="minStock"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={productForm.minStockStr}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      minStockStr: e.target.value.replace(/[^0-9]/g, ''),
                    })
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="commission">Comissão do barbeiro (%)</Label>
              <Input
                id="commission"
                type="text"
                inputMode="numeric"
                placeholder="10"
                value={productForm.commissionStr}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    commissionStr: e.target.value.replace(/[^0-9]/g, ''),
                  })
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="active"
                checked={productForm.active}
                onCheckedChange={(checked) => setProductForm({ ...productForm, active: checked })}
              />
              <Label htmlFor="active">Produto ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProductModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveProduct} disabled={saving}>
              {saving ? <LoadingSpinner /> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Modal */}
      <Dialog open={showCategoryModal} onOpenChange={setShowCategoryModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? 'Editar Categoria' : 'Nova Categoria'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="catName">Nome *</Label>
              <Input
                id="catName"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                placeholder="Nome da categoria"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="catOrder">Ordem de exibição</Label>
              <Input
                id="catOrder"
                type="number"
                min="0"
                value={categoryForm.sortOrder}
                onChange={(e) =>
                  setCategoryForm({
                    ...categoryForm,
                    sortOrder: parseInt(e.target.value || '0', 10),
                  })
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="catActive"
                checked={categoryForm.active}
                onCheckedChange={(checked) => setCategoryForm({ ...categoryForm, active: checked })}
              />
              <Label htmlFor="catActive">Categoria ativa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCategoryModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveCategory} disabled={saving}>
              {saving ? <LoadingSpinner /> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Movement Modal */}
      <Dialog open={showStockModal} onOpenChange={setShowStockModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movimentação de Estoque</DialogTitle>
            <DialogDescription>
              {stockProduct?.name} • Estoque atual: {stockProduct?.stockQuantity}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Tipo de movimentação</Label>
              <Select
                value={stockForm.type}
                onValueChange={(val) => setStockForm({ ...stockForm, type: val as 'in' | 'out' | 'adjustment' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Entrada</SelectItem>
                  <SelectItem value="out">Saída</SelectItem>
                  <SelectItem value="adjustment">Ajuste (definir quantidade)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stockQty">
                {stockForm.type === 'adjustment' ? 'Nova quantidade' : 'Quantidade'}
              </Label>
              <Input
                id="stockQty"
                type="number"
                min={stockForm.type === 'adjustment' ? 0 : 1}
                value={stockForm.quantity}
                onChange={(e) =>
                  setStockForm({
                    ...stockForm,
                    quantity: parseInt(e.target.value || '0', 10),
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stockReason">Motivo *</Label>
              <Input
                id="stockReason"
                value={stockForm.reason}
                onChange={(e) => setStockForm({ ...stockForm, reason: e.target.value })}
                placeholder="Ex: Compra de reposição"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStockModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveStock} disabled={saving}>
              {saving ? <LoadingSpinner /> : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config Modal */}
      <Dialog open={showConfigModal} onOpenChange={setShowConfigModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurações de Produtos</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="defComm">Comissão padrão (%)</Label>
              <Input
                id="defComm"
                type="number"
                step="1"
                min="0"
                max="100"
                value={Math.round(configForm.defaultCommissionPct * 100)}
                onChange={(e) =>
                  setConfigForm({
                    ...configForm,
                    defaultCommissionPct: parseInt(e.target.value || '0', 10) / 100,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="lowAlert">Alertas de estoque baixo</Label>
              <Switch
                id="lowAlert"
                checked={configForm.lowStockAlertEnabled}
                onCheckedChange={(checked) =>
                  setConfigForm({ ...configForm, lowStockAlertEnabled: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="whatsAlert">Notificar barbeiro via WhatsApp</Label>
              <Switch
                id="whatsAlert"
                checked={configForm.lowStockWhatsappEnabled}
                onCheckedChange={(checked) =>
                  setConfigForm({ ...configForm, lowStockWhatsappEnabled: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="blockZero">Bloquear venda com estoque zerado</Label>
              <Switch
                id="blockZero"
                checked={configForm.blockSaleOnZeroStock}
                onCheckedChange={(checked) =>
                  setConfigForm({ ...configForm, blockSaleOnZeroStock: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfigModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveConfig} disabled={saving}>
              {saving ? <LoadingSpinner /> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O produto "{deletingProduct?.name}" será
              removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProduct} disabled={saving}>
              {saving ? <LoadingSpinner /> : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sale Modal */}
      <SaleModal
        open={showSaleModal}
        onOpenChange={setShowSaleModal}
        onSuccess={() => {
          setShowSaleModal(false);
          loadData(); // Reload products to update stock
        }}
      />
    </AdminLayout>
  );
}
