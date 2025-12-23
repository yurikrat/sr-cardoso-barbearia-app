import { z } from 'zod';

export const customerIdentitySchema = z.object({
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  whatsappE164: z.string().regex(/^\+55\d{10,11}$/),
});

export const customerProfileSchema = z.object({
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  birthdayMmdd: z.string().regex(/^\d{4}$/).optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
});

export const customerConsentSchema = z.object({
  marketingOptIn: z.boolean(),
  marketingOptInAt: z.date().optional(),
  marketingOptOutAt: z.date().optional(),
});

export const customerStatsSchema = z.object({
  firstBookingAt: z.date().optional(),
  lastBookingAt: z.date().optional(),
  lastCompletedAt: z.date().optional(),
  totalBookings: z.number().int().min(0),
  totalCompleted: z.number().int().min(0),
  noShowCount: z.number().int().min(0),
  lastContactAt: z.date().optional(),
});

