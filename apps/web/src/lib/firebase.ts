/**
 * Caminho B (GCP puro): este módulo vira um adaptador para a API do Cloud Run.
 * Mantemos o nome `firebase.ts` para evitar um refactor gigante nos imports.
 * O rollback para o caminho A (Firebase SDK) fica documentado no README.
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

