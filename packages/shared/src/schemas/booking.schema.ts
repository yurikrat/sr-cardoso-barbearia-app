import { z } from 'zod';

export const serviceTypeSchema = z.enum(['cabelo', 'barba', 'cabelo_barba']);

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

