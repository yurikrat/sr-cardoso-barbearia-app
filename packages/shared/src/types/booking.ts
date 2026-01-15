// Catálogo de serviços agora é dinâmico (configurável pelo master).
// Mantemos o tipo como string; validação de "serviço existe/ativo" é feita no server.
export type ServiceType = string;

export type BookingStatus =
  | 'booked'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export type WhatsAppStatus = 'pending' | 'sent';

// Forma de pagamento (obrigatória ao concluir atendimento)
export type PaymentMethod = 'credit' | 'debit' | 'cash' | 'pix';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  credit: 'Cartão de Crédito',
  debit: 'Cartão de Débito',
  cash: 'Dinheiro',
  pix: 'Pix',
};

// Pagamento dividido (split) - para quando cliente paga com múltiplas formas
export interface PaymentSplit {
  method: PaymentMethod;
  amountCents: number;
}

export interface BookingCustomer {
  firstName: string;
  lastName: string;
  whatsappE164?: string;
}

export interface Booking {
  id: string;
  customerId: string;
  barberId: string;
  serviceType: ServiceType;
  slotStart: Date;
  dateKey: string; // YYYY-MM-DD
  customer: BookingCustomer;
  status: BookingStatus;
  whatsappStatus: WhatsAppStatus;
  isEncaixe?: boolean;
  paymentMethod?: PaymentMethod | null; // Forma de pagamento (preenchido ao concluir)
  paymentMethods?: PaymentSplit[] | null; // Split payment (novo) - sobrescreve paymentMethod se presente
  productsPurchased?: boolean; // Indica se houve compra de produtos no atendimento
  productSaleId?: string; // ID da venda de produtos vinculada ao atendimento
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  noShowAt?: Date;
  rescheduledFrom?: string; // bookingId
}

