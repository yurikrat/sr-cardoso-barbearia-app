/**
 * Tipos para gestão de produtos, vendas e estoque
 * Módulo integrado ao financeiro para consolidar faturamento
 */

import { PaymentMethod } from './booking';

// ============================================================
// CATEGORIAS DE PRODUTOS
// ============================================================

export interface ProductCategory {
  id: string;
  name: string;           // Ex: "Pomadas", "Cervejas", "Vinhos"
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Categorias padrão (fallback se não houver customizadas)
export const DEFAULT_PRODUCT_CATEGORIES: Omit<ProductCategory, 'createdAt' | 'updatedAt'>[] = [
  { id: 'pomadas', name: 'Pomadas', sortOrder: 1, active: true },
  { id: 'cervejas', name: 'Cervejas', sortOrder: 2, active: true },
  { id: 'vinhos', name: 'Vinhos', sortOrder: 3, active: true },
  { id: 'outros', name: 'Outros', sortOrder: 99, active: true },
];

// ============================================================
// PRODUTOS
// ============================================================

export interface Product {
  id: string;
  name: string;                   // Nome do produto
  description?: string;           // Descrição opcional
  categoryId: string;             // Referência à categoria
  priceCents: number;             // Preço de venda em centavos
  costCents?: number;             // Custo de aquisição (para margem)
  sku?: string;                   // Código de barras/SKU opcional
  stockQuantity: number;          // Quantidade atual em estoque
  minStockAlert: number;          // Quantidade mínima para alerta (0 = sem alerta)
  commissionPct: number;          // Comissão do barbeiro (ex: 0.10 = 10%)
  active: boolean;                // Se está disponível para venda
  imageUrl?: string;              // URL da imagem do produto (opcional)
  createdAt: Date;
  updatedAt: Date;
}

// Labels para exibição
export const PRODUCT_LABELS = {
  stockStatus: {
    ok: 'Em estoque',
    low: 'Estoque baixo',
    out: 'Sem estoque',
  },
} as const;

// ============================================================
// VENDAS
// ============================================================

export type SaleOrigin = 'standalone' | 'booking';

export interface SaleItem {
  productId: string;
  productName: string;            // Snapshot do nome no momento da venda
  quantity: number;
  unitPriceCents: number;         // Preço unitário no momento da venda
  commissionPct: number;          // Comissão no momento da venda
}

export interface Sale {
  id: string;
  customerId?: string;            // Opcional - venda pode ser anônima
  customerName?: string;          // Snapshot para exibição
  barberId: string;               // Quem realizou a venda
  barberName?: string;            // Snapshot para exibição
  items: SaleItem[];
  totalCents: number;             // Soma dos itens
  commissionCents: number;        // Total de comissão da venda
  paymentMethod: PaymentMethod;
  origin: SaleOrigin;             // 'standalone' ou 'booking'
  bookingId?: string;             // Se origin='booking', referência ao booking
  dateKey: string;                // YYYY-MM-DD para queries
  createdAt: Date;
  completedAt?: Date;
}

// ============================================================
// MOVIMENTAÇÕES DE ESTOQUE
// ============================================================

export type StockMovementType = 'in' | 'out' | 'adjustment' | 'sale';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;            // Snapshot
  type: StockMovementType;
  quantity: number;               // Positivo para entrada, negativo para saída
  previousQuantity: number;       // Estoque antes da movimentação
  newQuantity: number;            // Estoque após a movimentação
  reason: string;                 // Motivo (ex: "Compra", "Venda", "Ajuste de inventário")
  saleId?: string;                // Se type='sale', referência à venda
  createdBy: string;              // Username do admin que fez a movimentação
  createdAt: Date;
}

// ============================================================
// CONFIGURAÇÃO DE PRODUTOS
// ============================================================

export interface ProductsConfig {
  defaultCommissionPct: number;   // Comissão padrão para novos produtos (ex: 0.10)
  lowStockAlertEnabled: boolean;  // Se alertas de estoque baixo estão ativos
  lowStockWhatsappEnabled: boolean; // Se envia WhatsApp para barbeiro
  blockSaleOnZeroStock: boolean;  // Se bloqueia venda quando estoque = 0
}

export const DEFAULT_PRODUCTS_CONFIG: ProductsConfig = {
  defaultCommissionPct: 0.10,     // 10% padrão
  lowStockAlertEnabled: true,
  lowStockWhatsappEnabled: true,
  blockSaleOnZeroStock: false,    // Apenas alerta, não bloqueia
};

// ============================================================
// RESUMO FINANCEIRO DE PRODUTOS
// ============================================================

export interface ProductsSummary {
  totalSales: number;             // Quantidade de vendas
  totalRevenueCents: number;      // Faturamento total
  totalCommissionCents: number;   // Comissões totais
  totalItemsSold: number;         // Quantidade de itens vendidos
  byCategory: {
    categoryId: string;
    categoryName: string;
    revenueCents: number;
    itemsSold: number;
  }[];
  byProduct: {
    productId: string;
    productName: string;
    revenueCents: number;
    quantitySold: number;
  }[];
  byPaymentMethod: {
    method: PaymentMethod;
    revenueCents: number;
    count: number;
  }[];
}

// ============================================================
// ALERTAS DE ESTOQUE
// ============================================================

export interface StockAlert {
  productId: string;
  productName: string;
  categoryName: string;
  currentStock: number;
  minStock: number;
  status: 'low' | 'out';
  notifiedAt?: Date;              // Quando o alerta foi enviado por WhatsApp
}
