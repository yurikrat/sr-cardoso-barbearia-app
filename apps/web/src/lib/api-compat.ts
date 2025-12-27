/**
 * API Compatibility Layer
 * 
 * Wrapper functions that maintain backward-compatible signatures (returning { data })
 * while delegating to the Cloud Run REST API via @/lib/api.
 * 
 * This layer exists to avoid a massive refactor of existing useMutation calls.
 * All actual logic lives in Cloud Run (apps/server), not Firebase Cloud Functions.
 */
import { api } from '@/lib/api';

type CreateBookingPayload = {
  barberId: string;
  serviceType: string;
  slotStart: string;
  customer: { firstName: string; lastName: string; whatsapp: string };
};

// Compat: assinatura parecida com httpsCallable(). Retorna { data }.
export const createBookingFn = async (payload: CreateBookingPayload) => ({ data: await api.createBooking(payload) });
export const adminCancelBookingFn = async (payload: { bookingId: string }) => ({
  data: await api.admin.cancelBooking(payload.bookingId),
});
export const adminRescheduleBookingFn = async (payload: { bookingId: string; newSlotStart: string }) => ({
  data: await api.admin.rescheduleBooking(payload.bookingId, payload.newSlotStart),
});
export const adminBlockSlotsFn = async (payload: {
  barberId: string;
  startTime: string;
  endTime: string;
  reason: string;
}) => ({ data: await api.admin.blockSlots(payload) });
export const adminMarkWhatsappSentFn = async (payload: { bookingId: string }) => ({
  data: await api.admin.markWhatsappSent(payload.bookingId),
});

