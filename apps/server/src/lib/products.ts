import type { Firestore } from '@google-cloud/firestore';
import { FieldValue } from '@google-cloud/firestore';
import type {
  Product,
  ProductCategory,
  Sale,
  SaleItem,
  StockMovement,
  ProductsConfig,
  StockAlert,
  ProductsSummary,
} from '@sr-cardoso/shared';
import {
  DEFAULT_PRODUCT_CATEGORIES,
  DEFAULT_PRODUCTS_CONFIG,
} from '@sr-cardoso/shared';
import { getNow, getDateKey } from '@sr-cardoso/shared';
import { OWNER_BARBER_ID } from './finance.js';

// ============================================================
// COLLECTION PATHS
// ============================================================

const PRODUCTS_COLLECTION = 'products';
const PRODUCT_CATEGORIES_COLLECTION = 'productCategories';
const SALES_COLLECTION = 'sales';
const STOCK_MOVEMENTS_COLLECTION = 'stockMovements';
const PRODUCTS_CONFIG_DOC = 'settings/products';

function stripUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

// ============================================================
// CACHE
// ============================================================

let productsConfigCache: { value: ProductsConfig; fetchedAtMs: number } | null = null;
const PRODUCTS_CONFIG_TTL_MS = 30_000;

// ============================================================
// CONFIGURAÇÃO
// ============================================================

export async function getProductsConfig(db: Firestore): Promise<ProductsConfig> {
  const now = Date.now();
  if (productsConfigCache && now - productsConfigCache.fetchedAtMs < PRODUCTS_CONFIG_TTL_MS) {
    return productsConfigCache.value;
  }
  const doc = await db.doc(PRODUCTS_CONFIG_DOC).get();
  const data = doc.exists ? (doc.data() as Partial<ProductsConfig>) : {};
  const config: ProductsConfig = {
    ...DEFAULT_PRODUCTS_CONFIG,
    ...data,
  };
  productsConfigCache = { value: config, fetchedAtMs: now };
  return config;
}

export async function updateProductsConfig(
  db: Firestore,
  updates: Partial<ProductsConfig>
): Promise<ProductsConfig> {
  await db.doc(PRODUCTS_CONFIG_DOC).set(updates, { merge: true });
  productsConfigCache = null; // Invalidate cache
  return getProductsConfig(db);
}

// ============================================================
// CATEGORIAS
// ============================================================

export async function listProductCategories(db: Firestore): Promise<ProductCategory[]> {
  const snapshot = await db.collection(PRODUCT_CATEGORIES_COLLECTION).orderBy('sortOrder').get();
  if (snapshot.empty) {
    // Retorna categorias padrão se não houver customizadas
    const now = new Date();
    return DEFAULT_PRODUCT_CATEGORIES.map((c) => ({
      ...c,
      createdAt: now,
      updatedAt: now,
    }));
  }
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      active: data.active ?? true,
      createdAt: data.createdAt?.toDate() ?? new Date(),
      updatedAt: data.updatedAt?.toDate() ?? new Date(),
    } as ProductCategory;
  });
}

export async function createProductCategory(
  db: Firestore,
  data: Omit<ProductCategory, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ProductCategory> {
  const now = new Date();
  const docRef = db.collection(PRODUCT_CATEGORIES_COLLECTION).doc();
  const category: ProductCategory = {
    ...data,
    id: docRef.id,
    createdAt: now,
    updatedAt: now,
  };
  await docRef.set(category);
  return category;
}

export async function updateProductCategory(
  db: Firestore,
  id: string,
  updates: Partial<Omit<ProductCategory, 'id' | 'createdAt'>>
): Promise<ProductCategory | null> {
  const docRef = db.collection(PRODUCT_CATEGORIES_COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return null;
  const now = new Date();
  await docRef.update({ ...updates, updatedAt: now });
  const updated = await docRef.get();
  const data = updated.data()!;
  return {
    id: updated.id,
    name: data.name,
    sortOrder: data.sortOrder ?? 0,
    active: data.active ?? true,
    createdAt: data.createdAt?.toDate() ?? new Date(),
    updatedAt: data.updatedAt?.toDate() ?? new Date(),
  };
}

export async function deleteProductCategory(db: Firestore, id: string): Promise<boolean> {
  // Verifica se há produtos usando esta categoria
  const productsSnapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where('categoryId', '==', id)
    .limit(1)
    .get();
  if (!productsSnapshot.empty) {
    throw new Error('Não é possível excluir categoria com produtos associados');
  }
  await db.collection(PRODUCT_CATEGORIES_COLLECTION).doc(id).delete();
  return true;
}

// ============================================================
// PRODUTOS
// ============================================================

export async function listProducts(
  db: Firestore,
  options?: { categoryId?: string; activeOnly?: boolean }
): Promise<Product[]> {
  let query: FirebaseFirestore.Query = db.collection(PRODUCTS_COLLECTION);
  
  // Aplicar filtro por categoria se especificado
  if (options?.categoryId) {
    query = query.where('categoryId', '==', options.categoryId);
  }
  
  // Buscar todos os produtos (aplicamos filtro active em memória para evitar necessidade de índice composto)
  const snapshot = await query.get();
  let products = snapshot.docs.map((doc) => docToProduct(doc.id, doc.data()));
  
  // Filtrar por active em memória se necessário
  if (options?.activeOnly) {
    products = products.filter((p) => p.active);
  }
  
  // Ordenar por nome em memória
  products.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  
  return products;
}

export async function getProduct(db: Firestore, id: string): Promise<Product | null> {
  const doc = await db.collection(PRODUCTS_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return docToProduct(doc.id, doc.data()!);
}

export async function createProduct(
  db: Firestore,
  data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Product> {
  const now = new Date();
  const docRef = db.collection(PRODUCTS_COLLECTION).doc();
  const product: Product = {
    ...data,
    id: docRef.id,
    createdAt: now,
    updatedAt: now,
  };
  await docRef.set(stripUndefined(product));
  return product;
}

export async function updateProduct(
  db: Firestore,
  id: string,
  updates: Partial<Omit<Product, 'id' | 'createdAt'>>
): Promise<Product | null> {
  const docRef = db.collection(PRODUCTS_COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return null;
  const now = new Date();
  const sanitized = stripUndefined(updates);
  await docRef.update({ ...sanitized, updatedAt: now });
  const updated = await docRef.get();
  return docToProduct(updated.id, updated.data()!);
}

export async function deleteProduct(db: Firestore, id: string): Promise<boolean> {
  await db.collection(PRODUCTS_COLLECTION).doc(id).delete();
  return true;
}

function docToProduct(id: string, data: FirebaseFirestore.DocumentData): Product {
  return {
    id,
    name: data.name ?? '',
    description: data.description,
    categoryId: data.categoryId ?? '',
    priceCents: data.priceCents ?? 0,
    costCents: data.costCents,
    sku: data.sku,
    stockQuantity: data.stockQuantity ?? 0,
    minStockAlert: data.minStockAlert ?? 0,
    commissionPct: data.commissionPct ?? 0.1,
    active: data.active ?? true,
    imageUrl: data.imageUrl,
    createdAt: data.createdAt?.toDate() ?? new Date(),
    updatedAt: data.updatedAt?.toDate() ?? new Date(),
  };
}

// ============================================================
// VENDAS
// ============================================================

export async function createSale(
  db: Firestore,
  data: {
    customerId?: string;
    customerName?: string;
    barberId: string;
    barberName?: string;
    items: { productId: string; quantity: number }[];
    paymentMethod: Sale['paymentMethod'];
    origin: Sale['origin'];
    bookingId?: string;
    discountCents?: number;
  },
  createdBy: string
): Promise<Sale> {
  const config = await getProductsConfig(db);
  const now = getNow();
  const saleItems: SaleItem[] = [];
  let totalCents = 0;
  let commissionCents = 0;

  const isOwner = data.barberId === OWNER_BARBER_ID;

  // Busca produtos e monta itens
  for (const item of data.items) {
    const product = await getProduct(db, item.productId);
    if (!product) {
      throw new Error(`Produto não encontrado: ${item.productId}`);
    }
    if (!product.active) {
      throw new Error(`Produto inativo: ${product.name}`);
    }
    if (config.blockSaleOnZeroStock && product.stockQuantity < item.quantity) {
      throw new Error(`Estoque insuficiente para ${product.name}`);
    }
    const itemTotal = product.priceCents * item.quantity;
    const effectiveCommissionPct = isOwner ? 0 : product.commissionPct;
    const itemCommission = Math.round(itemTotal * effectiveCommissionPct);
    saleItems.push({
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
      commissionPct: effectiveCommissionPct,
    });
    totalCents += itemTotal;
    commissionCents += itemCommission;
  }

  const saleRef = db.collection(SALES_COLLECTION).doc();
  const discountCents = Math.max(0, data.discountCents ?? 0);
  const finalTotalCents = Math.max(0, totalCents - discountCents);
  const commissionRatio = totalCents > 0 ? finalTotalCents / totalCents : 0;
  const finalCommissionCents = Math.round(commissionCents * commissionRatio);
  const sale: Sale = {
    id: saleRef.id,
    barberId: data.barberId,
    items: saleItems,
    totalCents: finalTotalCents,
    commissionCents: finalCommissionCents,
    paymentMethod: data.paymentMethod,
    origin: data.origin,
    dateKey: getDateKey(now),
    createdAt: now.toJSDate(),
    completedAt: now.toJSDate(),
    ...(data.customerId ? { customerId: data.customerId } : {}),
    ...(data.customerName ? { customerName: data.customerName } : {}),
    ...(data.barberName ? { barberName: data.barberName } : {}),
    ...(data.bookingId ? { bookingId: data.bookingId } : {}),
    ...(discountCents > 0 ? { discountCents } : {}),
  };

  const customerRef = data.customerId ? db.collection('customers').doc(data.customerId) : null;
  const bookingRef = data.bookingId ? db.collection('bookings').doc(data.bookingId) : null;

  // Transação para criar venda e atualizar estoque
  await db.runTransaction(async (transaction) => {
    const customerDoc = customerRef ? await transaction.get(customerRef) : null;
    const bookingDoc = bookingRef ? await transaction.get(bookingRef) : null;
    const productSnapshots = await Promise.all(
      saleItems.map(async (item) => {
        const productRef = db.collection(PRODUCTS_COLLECTION).doc(item.productId);
        const productDoc = await transaction.get(productRef);
        return { item, productRef, productDoc };
      })
    );

    // Atualiza estoque de cada produto
    for (const { item, productRef, productDoc } of productSnapshots) {
      const productData = productDoc.data()!;
      const previousQuantity = productData.stockQuantity ?? 0;
      const newQuantity = Math.max(0, previousQuantity - item.quantity);

      transaction.update(productRef, {
        stockQuantity: newQuantity,
        updatedAt: now.toJSDate(),
      });

      // Registra movimentação de estoque
      const movementRef = db.collection(STOCK_MOVEMENTS_COLLECTION).doc();
      const movement: StockMovement = {
        id: movementRef.id,
        productId: item.productId,
        productName: item.productName,
        type: 'sale',
        quantity: -item.quantity,
        previousQuantity,
        newQuantity,
        reason: `Venda #${sale.id.slice(-6)}`,
        saleId: sale.id,
        createdBy,
        createdAt: now.toJSDate(),
      };
      transaction.set(movementRef, movement);
    }

    if (customerRef && customerDoc?.exists) {
      transaction.update(customerRef, {
        'stats.totalPurchases': FieldValue.increment(1),
        'stats.totalSpentCents': FieldValue.increment(totalCents),
        'stats.lastPurchaseAt': now.toJSDate(),
      });
    }

    if (bookingRef && bookingDoc?.exists) {
      transaction.update(bookingRef, {
        productsPurchased: true,
        productSaleId: sale.id,
        updatedAt: now.toJSDate(),
      });
    }

    transaction.set(saleRef, sale);
  });

  return sale;
}

export async function listSales(
  db: Firestore,
  options?: {
    barberId?: string;
    dateKey?: string;
    startDate?: string;
    endDate?: string;
    origin?: Sale['origin'];
    productId?: string;
  }
): Promise<Sale[]> {
  let query = db.collection(SALES_COLLECTION).orderBy('createdAt', 'desc');

  if (options?.barberId) {
    query = query.where('barberId', '==', options.barberId) as any;
  }
  if (options?.dateKey) {
    query = query.where('dateKey', '==', options.dateKey) as any;
  }
  if (options?.startDate) {
    query = query.where('dateKey', '>=', options.startDate) as any;
  }
  if (options?.endDate) {
    query = query.where('dateKey', '<=', options.endDate) as any;
  }
  if (options?.origin) {
    query = query.where('origin', '==', options.origin) as any;
  }

  const snapshot = await query.limit(500).get();
  let sales = snapshot.docs.map((doc) => docToSale(doc.id, doc.data()));

  // Filtrar por productId no cliente (Firestore não suporta array-contains em campo aninhado)
  if (options?.productId) {
    sales = sales.filter((sale) =>
      sale.items.some((item) => item.productId === options.productId)
    );
  }

  return sales;
}

export async function getSale(db: Firestore, id: string): Promise<Sale | null> {
  const doc = await db.collection(SALES_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return docToSale(doc.id, doc.data()!);
}

export async function deleteSale(
  db: Firestore,
  saleId: string,
  deletedBy: string
): Promise<void> {
  const sale = await getSale(db, saleId);
  if (!sale) {
    throw new Error('Venda não encontrada');
  }

  const now = getNow();

  const customerRef = sale.customerId ? db.collection('customers').doc(sale.customerId) : null;
  const bookingRef = sale.bookingId ? db.collection('bookings').doc(sale.bookingId) : null;

  // Transação para deletar venda e reverter estoque
  await db.runTransaction(async (transaction) => {
    const customerDoc = customerRef ? await transaction.get(customerRef) : null;
    const bookingDoc = bookingRef ? await transaction.get(bookingRef) : null;
    // Remove a venda
    const saleRef = db.collection(SALES_COLLECTION).doc(saleId);
    transaction.delete(saleRef);

    // Reverte estoque de cada produto
    for (const item of sale.items) {
      const productRef = db.collection(PRODUCTS_COLLECTION).doc(item.productId);
      const productDoc = await transaction.get(productRef);

      if (productDoc.exists) {
        const productData = productDoc.data()!;
        const previousQuantity = productData.stockQuantity ?? 0;
        const newQuantity = previousQuantity + item.quantity;

        transaction.update(productRef, {
          stockQuantity: newQuantity,
          updatedAt: now.toJSDate(),
        });

        // Registra movimentação de estorno
        const movementRef = db.collection(STOCK_MOVEMENTS_COLLECTION).doc();
        const movement: StockMovement = {
          id: movementRef.id,
          productId: item.productId,
          productName: item.productName,
          type: 'adjustment',
          quantity: item.quantity,
          previousQuantity,
          newQuantity,
          reason: `Estorno de venda cancelada #${sale.id.slice(-6)}`,
          saleId: sale.id,
          createdBy: deletedBy,
          createdAt: now.toJSDate(),
        };
        transaction.set(movementRef, movement);
      }
    }

    if (customerRef && customerDoc?.exists) {
      transaction.update(customerRef, {
        'stats.totalPurchases': FieldValue.increment(-1),
        'stats.totalSpentCents': FieldValue.increment(-sale.totalCents),
        'stats.lastPurchaseAt': now.toJSDate(),
      });
    }

    if (bookingRef && bookingDoc?.exists) {
      transaction.update(bookingRef, {
        productsPurchased: false,
        productSaleId: null,
        updatedAt: now.toJSDate(),
      });
    }
  });
}

function docToSale(id: string, data: FirebaseFirestore.DocumentData): Sale {
  return {
    id,
    customerId: data.customerId,
    customerName: data.customerName,
    barberId: data.barberId ?? '',
    barberName: data.barberName,
    items: data.items ?? [],
    totalCents: data.totalCents ?? 0,
    discountCents: data.discountCents,
    commissionCents: data.commissionCents ?? 0,
    paymentMethod: data.paymentMethod ?? 'cash',
    origin: data.origin ?? 'standalone',
    bookingId: data.bookingId,
    dateKey: data.dateKey ?? '',
    createdAt: data.createdAt?.toDate() ?? new Date(),
    completedAt: data.completedAt?.toDate(),
  };
}

// ============================================================
// MOVIMENTAÇÃO DE ESTOQUE
// ============================================================

export async function createStockMovement(
  db: Firestore,
  data: {
    productId: string;
    type: 'in' | 'out' | 'adjustment';
    quantity: number;
    reason: string;
  },
  createdBy: string
): Promise<StockMovement> {
  const product = await getProduct(db, data.productId);
  if (!product) {
    throw new Error(`Produto não encontrado: ${data.productId}`);
  }

  const now = getNow();
  const previousQuantity = product.stockQuantity;
  let newQuantity: number;

  if (data.type === 'in') {
    newQuantity = previousQuantity + Math.abs(data.quantity);
  } else if (data.type === 'out') {
    newQuantity = Math.max(0, previousQuantity - Math.abs(data.quantity));
  } else {
    // adjustment: quantity é o valor absoluto desejado
    newQuantity = Math.max(0, data.quantity);
  }

  const movementRef = db.collection(STOCK_MOVEMENTS_COLLECTION).doc();
  const movement: StockMovement = {
    id: movementRef.id,
    productId: product.id,
    productName: product.name,
    type: data.type,
    quantity: data.type === 'adjustment' ? newQuantity - previousQuantity : data.quantity,
    previousQuantity,
    newQuantity,
    reason: data.reason,
    createdBy,
    createdAt: now.toJSDate(),
  };

  await db.runTransaction(async (transaction) => {
    transaction.set(movementRef, movement);
    transaction.update(db.collection(PRODUCTS_COLLECTION).doc(product.id), {
      stockQuantity: newQuantity,
      updatedAt: now.toJSDate(),
    });
  });

  return movement;
}

export async function listStockMovements(
  db: Firestore,
  options?: { productId?: string; limit?: number }
): Promise<StockMovement[]> {
  let query = db.collection(STOCK_MOVEMENTS_COLLECTION).orderBy('createdAt', 'desc');
  if (options?.productId) {
    query = query.where('productId', '==', options.productId) as any;
  }
  const snapshot = await query.limit(options?.limit ?? 100).get();
  return snapshot.docs.map((doc) => docToStockMovement(doc.id, doc.data()));
}

function docToStockMovement(id: string, data: FirebaseFirestore.DocumentData): StockMovement {
  return {
    id,
    productId: data.productId ?? '',
    productName: data.productName ?? '',
    type: data.type ?? 'adjustment',
    quantity: data.quantity ?? 0,
    previousQuantity: data.previousQuantity ?? 0,
    newQuantity: data.newQuantity ?? 0,
    reason: data.reason ?? '',
    saleId: data.saleId,
    createdBy: data.createdBy ?? '',
    createdAt: data.createdAt?.toDate() ?? new Date(),
  };
}

// ============================================================
// ALERTAS DE ESTOQUE
// ============================================================

export async function getStockAlerts(db: Firestore): Promise<StockAlert[]> {
  const config = await getProductsConfig(db);
  if (!config.lowStockAlertEnabled) return [];

  const products = await listProducts(db, { activeOnly: true });
  const categories = await listProductCategories(db);
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const alerts: StockAlert[] = [];

  for (const product of products) {
    if (product.minStockAlert <= 0) continue;
    if (product.stockQuantity <= 0) {
      alerts.push({
        productId: product.id,
        productName: product.name,
        categoryName: categoryMap.get(product.categoryId) ?? 'Outros',
        currentStock: product.stockQuantity,
        minStock: product.minStockAlert,
        status: 'out',
      });
    } else if (product.stockQuantity <= product.minStockAlert) {
      alerts.push({
        productId: product.id,
        productName: product.name,
        categoryName: categoryMap.get(product.categoryId) ?? 'Outros',
        currentStock: product.stockQuantity,
        minStock: product.minStockAlert,
        status: 'low',
      });
    }
  }

  return alerts.sort((a, b) => {
    // Out first, then by current stock
    if (a.status !== b.status) return a.status === 'out' ? -1 : 1;
    return a.currentStock - b.currentStock;
  });
}

// ============================================================
// RESUMO FINANCEIRO DE PRODUTOS
// ============================================================

export async function getProductsSummary(
  db: Firestore,
  options?: { startDate?: string; endDate?: string; barberId?: string }
): Promise<ProductsSummary> {
  const sales = await listSales(db, options);
  const categories = await listProductCategories(db);
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const products = await listProducts(db);
  const productCategoryMap = new Map(products.map((p) => [p.id, p.categoryId]));

  const summary: ProductsSummary = {
    totalSales: sales.length,
    totalRevenueCents: 0,
    totalCommissionCents: 0,
    totalItemsSold: 0,
    byCategory: [],
    byProduct: [],
    byPaymentMethod: [],
    byBarber: [],
  };

  const categoryStats = new Map<string, { revenueCents: number; itemsSold: number }>();
  const productStats = new Map<string, { productName: string; revenueCents: number; quantitySold: number }>();
  const paymentStats = new Map<string, { revenueCents: number; count: number }>();
  const barberStats = new Map<string, { barberName: string; revenueCents: number; commissionCents: number; salesCount: number; itemsSold: number }>();

  for (const sale of sales) {
    summary.totalRevenueCents += sale.totalCents;
    summary.totalCommissionCents += sale.commissionCents;

    // Payment method stats
    const pm = paymentStats.get(sale.paymentMethod) ?? { revenueCents: 0, count: 0 };
    pm.revenueCents += sale.totalCents;
    pm.count += 1;
    paymentStats.set(sale.paymentMethod, pm);

    // Barber stats
    const bs = barberStats.get(sale.barberId) ?? { 
      barberName: sale.barberName ?? sale.barberId, 
      revenueCents: 0, 
      commissionCents: 0, 
      salesCount: 0, 
      itemsSold: 0 
    };
    bs.revenueCents += sale.totalCents;
    bs.commissionCents += sale.commissionCents;
    bs.salesCount += 1;
    
    let saleItemsCount = 0;
    for (const item of sale.items) {
      summary.totalItemsSold += item.quantity;
      saleItemsCount += item.quantity;
      const itemRevenue = item.unitPriceCents * item.quantity;

      // Product stats
      const ps = productStats.get(item.productId) ?? { productName: item.productName, revenueCents: 0, quantitySold: 0 };
      ps.revenueCents += itemRevenue;
      ps.quantitySold += item.quantity;
      productStats.set(item.productId, ps);

      // Category stats
      const categoryId = productCategoryMap.get(item.productId) ?? 'outros';
      const cs = categoryStats.get(categoryId) ?? { revenueCents: 0, itemsSold: 0 };
      cs.revenueCents += itemRevenue;
      cs.itemsSold += item.quantity;
      categoryStats.set(categoryId, cs);
    }
    
    bs.itemsSold += saleItemsCount;
    barberStats.set(sale.barberId, bs);
  }

  summary.byCategory = Array.from(categoryStats.entries()).map(([categoryId, stats]) => ({
    categoryId,
    categoryName: categoryMap.get(categoryId) ?? 'Outros',
    ...stats,
  })).sort((a, b) => b.revenueCents - a.revenueCents);

  summary.byProduct = Array.from(productStats.entries()).map(([productId, stats]) => ({
    productId,
    ...stats,
  })).sort((a, b) => b.revenueCents - a.revenueCents);

  summary.byPaymentMethod = Array.from(paymentStats.entries()).map(([method, stats]) => ({
    method: method as Sale['paymentMethod'],
    ...stats,
  })).sort((a, b) => b.revenueCents - a.revenueCents);

  summary.byBarber = Array.from(barberStats.entries()).map(([barberId, stats]) => ({
    barberId,
    ...stats,
  })).sort((a, b) => b.revenueCents - a.revenueCents);

  return summary;
}
