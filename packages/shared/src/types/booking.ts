export type ServiceType = 'cabelo' | 'barba' | 'cabelo_barba';

export type BookingStatus =
  | 'booked'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export type WhatsAppStatus = 'pending' | 'sent';

export interface BookingCustomer {
  firstName: string;
  lastName: string;
  whatsappE164: string;
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
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  noShowAt?: Date;
  rescheduledFrom?: string; // bookingId
}

