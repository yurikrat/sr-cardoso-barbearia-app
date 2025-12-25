import { z } from 'zod';

// Catálogo de serviços é dinâmico (ids como "cabelo", "barba", "cabelo_barba", etc.)
export const serviceTypeSchema = z
  .string()
  .min(1)
  .max(31)
  .regex(/^[a-z0-9][a-z0-9_-]{0,30}$/, 'serviceType inválido');

export const bookingStatusSchema = z.enum([
  'booked',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
]);

export const whatsappStatusSchema = z.enum(['pending', 'sent']);

export const createBookingRequestSchema = z.object({
  barberId: z.string().min(1),
  serviceType: serviceTypeSchema,
  slotStart: z.string().datetime({ offset: true }), // ISO 8601 (com timezone offset)
  customer: z.object({
    firstName: z.string().min(2).max(50),
    lastName: z.string().min(2).max(50),
    whatsapp: z.string().min(10), // Será normalizado para E.164
  }),
});

export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

