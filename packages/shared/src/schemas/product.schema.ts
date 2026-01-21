import { z } from 'zod';

// ============================================================
// SCHEMAS DE CATEGORIAS
// ============================================================

export const productCategorySchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  active: z.boolean(),
});

export const createProductCategorySchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional().default(true),
});

export const updateProductCategorySchema = createProductCategorySchema.partial();

// ============================================================
// SCHEMAS DE PRODUTOS
// ============================================================

export const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  categoryId: z.string().min(1),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0).optional(),
  sku: z.string().max(50).optional(),
  stockQuantity: z.number().int().min(0),
  minStockAlert: z.number().int().min(0),
  commissionPct: z.number().min(0).max(1), // 0-100% como 0-1
  active: z.boolean(),
  imageUrl: z.string().url().optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  categoryId: z.string().min(1),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0).optional(),
  sku: z.string().max(50).optional(),
  stockQuantity: z.number().int().min(0).optional().default(0),
  minStockAlert: z.number().int().min(0).optional().default(0),
  commissionPct: z.number().min(0).max(1).optional(), // Usa default da config se não informado
  active: z.boolean().optional().default(true),
  imageUrl: z.string().url().optional(),
});

export const updateProductSchema = createProductSchema.partial();

// ============================================================
// SCHEMAS DE VENDAS
// ============================================================

export const paymentMethodSchema = z.enum(['credit', 'debit', 'cash', 'pix']);

export const saleOriginSchema = z.enum(['standalone', 'booking']);

export const saleItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  commissionPct: z.number().min(0).max(1),
});

export const saleSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  barberId: z.string().min(1),
  barberName: z.string().optional(),
  items: z.array(saleItemSchema).min(1),
  totalCents: z.number().int().min(0),
  commissionCents: z.number().int().min(0),
  paymentMethod: paymentMethodSchema,
  origin: saleOriginSchema,
  bookingId: z.string().optional(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const createSaleSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  barberId: z.string().min(1),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1),
    })
  ).min(1),
  paymentMethod: paymentMethodSchema,
  discountCents: z.number().int().min(0).optional(),
  origin: saleOriginSchema.optional().default('standalone'),
  bookingId: z.string().optional(),
});

// ============================================================
// SCHEMAS DE MOVIMENTAÇÃO DE ESTOQUE
// ============================================================

export const stockMovementTypeSchema = z.enum(['in', 'out', 'adjustment', 'sale']);

export const stockMovementSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  type: stockMovementTypeSchema,
  quantity: z.number().int(), // Pode ser negativo para saídas
  previousQuantity: z.number().int().min(0),
  newQuantity: z.number().int().min(0),
  reason: z.string().min(1).max(200),
  saleId: z.string().optional(),
  createdBy: z.string().min(1),
});

export const createStockMovementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(['in', 'out', 'adjustment']), // 'sale' é automático
  quantity: z.number().int().refine((val) => val !== 0, 'Quantidade não pode ser zero'),
  reason: z.string().min(1).max(200),
});

// ============================================================
// SCHEMAS DE CONFIGURAÇÃO
// ============================================================

export const productsConfigSchema = z.object({
  defaultCommissionPct: z.number().min(0).max(1),
  lowStockAlertEnabled: z.boolean(),
  lowStockWhatsappEnabled: z.boolean(),
  blockSaleOnZeroStock: z.boolean(),
});

export const updateProductsConfigSchema = productsConfigSchema.partial();

// ============================================================
// TYPE EXPORTS
// ============================================================

export type CreateProductCategory = z.infer<typeof createProductCategorySchema>;
export type UpdateProductCategory = z.infer<typeof updateProductCategorySchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type CreateSale = z.infer<typeof createSaleSchema>;
export type CreateStockMovement = z.infer<typeof createStockMovementSchema>;
export type UpdateProductsConfig = z.infer<typeof updateProductsConfigSchema>;
