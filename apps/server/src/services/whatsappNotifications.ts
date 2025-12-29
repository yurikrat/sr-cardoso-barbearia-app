import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import { DateTime } from 'luxon';
import { createEvolutionClient, getEvolutionInstanceName, toEvolutionNumber, type EvolutionRequestError } from '../lib/evolutionApi.js';
import type { Env } from '../lib/env.js';
import type {
  WhatsAppNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  WhatsAppMessageQueue,
  MessageType,
} from '@sr-cardoso/shared';

const SETTINGS_DOC_PATH = 'settings/whatsapp-notifications';
const MESSAGE_QUEUE_COLLECTION = 'whatsappMessageQueue';

/**
 * Carrega configurações de notificação do Firestore
 */
export async function getNotificationSettings(db: Firestore): Promise<WhatsAppNotificationSettings> {
  const doc = await db.doc(SETTINGS_DOC_PATH).get();
  if (!doc.exists) {
    return {
      confirmationEnabled: true,
      confirmationMessage: 'Seu agendamento foi confirmado! Esperamos você na barbearia.',
      reminderEnabled: true,
      reminderMinutesBefore: 60,
      reminderMessage: 'Lembrete: seu horário na barbearia é daqui a pouco. Não se atrase!',
      cancellationMessage: 'Seu agendamento foi cancelado conforme solicitado. Esperamos você em breve!',
    };
  }
  return doc.data() as WhatsAppNotificationSettings;
}

/**
 * Salva configurações de notificação no Firestore
 */
export async function saveNotificationSettings(
  db: Firestore,
  settings: WhatsAppNotificationSettings,
  updatedBy: string
): Promise<void> {
  await db.doc(SETTINGS_DOC_PATH).set({
    ...settings,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy,
  });
}

/**
 * Formata data/hora para exibição amigável
 */
function formatDateTime(date: Date): { data: string; hora: string } {
  const dt = DateTime.fromJSDate(date).setZone('America/Sao_Paulo');
  return {
    data: dt.toFormat("EEEE, d 'de' MMMM", { locale: 'pt-BR' }),
    hora: dt.toFormat('HH:mm'),
  };
}

/**
 * Busca o nome do serviço pelo ID
 */
async function getServiceName(db: Firestore, serviceType: string): Promise<string> {
  const configDoc = await db.doc('settings/finance').get();
  if (!configDoc.exists) return serviceType;
  
  const config = configDoc.data();
  const services = config?.services || [];
  const service = services.find((s: any) => s.id === serviceType);
  return service?.label || serviceType;
}

/**
 * Busca o nome do barbeiro pelo ID
 */
async function getBarberName(db: Firestore, barberId: string): Promise<string> {
  const barberDoc = await db.doc(`barbers/${barberId}`).get();
  if (!barberDoc.exists) return 'Barbeiro';
  const data = barberDoc.data();
  return data?.name || 'Barbeiro';
}

interface BookingData {
  id: string;
  customerId: string;
  barberId: string;
  serviceType: string;
  slotStart: Date;
  customer: {
    firstName: string;
    lastName: string;
    whatsappE164: string;
  };
  cancelCode?: string; // Só disponível na criação, não armazenado
}

/**
 * Constrói mensagem de confirmação personalizada
 */
async function buildConfirmationMessage(
  db: Firestore,
  booking: BookingData,
  customMessage: string,
  cancelLink: string
): Promise<string> {
  const { data, hora } = formatDateTime(booking.slotStart);
  const serviceName = await getServiceName(db, booking.serviceType);
  const barberName = await getBarberName(db, booking.barberId);
  
  const lines = [
    `Olá, ${booking.customer.firstName}! 👋`,
    '',
    customMessage,
    '',
    '📋 *Detalhes do agendamento:*',
    `• Serviço: ${serviceName}`,
    `• Profissional: ${barberName}`,
    `• Data: ${data}`,
    `• Horário: ${hora}`,
    '',
    '🔗 Precisa cancelar ou reagendar?',
    cancelLink,
    '',
    'Até breve! ✂️',
  ];
  
  return lines.join('\n');
}

/**
 * Constrói mensagem de lembrete personalizada
 */
async function buildReminderMessage(
  db: Firestore,
  booking: BookingData,
  customMessage: string
): Promise<string> {
  const { hora } = formatDateTime(booking.slotStart);
  const serviceName = await getServiceName(db, booking.serviceType);
  
  const lines = [
    `Olá, ${booking.customer.firstName}! ⏰`,
    '',
    customMessage,
    '',
    `📋 Seu horário: *${hora}*`,
    `✂️ Serviço: ${serviceName}`,
    '',
    'Te esperamos!',
  ];
  
  return lines.join('\n');
}

/**
 * Constrói mensagem de cancelamento
 */
async function buildCancellationMessage(
  db: Firestore,
  booking: BookingData,
  customMessage: string,
  baseUrl: string
): Promise<string> {
  const lines = [
    `Olá, ${booking.customer.firstName}!`,
    '',
    customMessage,
    '',
    '📅 Quer fazer um novo agendamento?',
    baseUrl,
  ];
  
  return lines.join('\n');
}

/**
 * Adiciona mensagem à fila para retry
 */
async function addToQueue(
  db: Firestore,
  booking: BookingData,
  messageType: MessageType,
  messageText: string
): Promise<string> {
  const queueRef = db.collection(MESSAGE_QUEUE_COLLECTION).doc();
  const queueItem: Omit<WhatsAppMessageQueue, 'id'> = {
    bookingId: booking.id,
    customerId: booking.customerId,
    phoneE164: booking.customer.whatsappE164,
    messageType,
    messageText,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date(),
  };
  
  await queueRef.set({
    ...queueItem,
    createdAt: FieldValue.serverTimestamp(),
  });
  
  return queueRef.id;
}

/**
 * Tenta enviar mensagem via Evolution API
 */
async function sendWhatsAppMessage(
  env: Env,
  phoneE164: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const evo = createEvolutionClient(env);
    const instanceName = getEvolutionInstanceName(env);
    
    await evo.post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      number: toEvolutionNumber(phoneE164),
      text,
    });
    
    return { success: true };
  } catch (e: any) {
    const err = e as EvolutionRequestError;
    const errorMsg = err?.message || 'Erro desconhecido ao enviar mensagem';
    console.error('WhatsApp send error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Envia confirmação de agendamento
 */
export async function sendBookingConfirmation(
  db: Firestore,
  env: Env,
  booking: BookingData,
  cancelCode: string,
  baseUrl: string
): Promise<{ sent: boolean; queued: boolean; error?: string }> {
  const settings = await getNotificationSettings(db);
  
  if (!settings.confirmationEnabled) {
    return { sent: false, queued: false };
  }
  
  const cancelLink = `${baseUrl}/cancelar/${booking.id}?code=${cancelCode}`;
  const message = await buildConfirmationMessage(db, booking, settings.confirmationMessage, cancelLink);
  
  const result = await sendWhatsAppMessage(env, booking.customer.whatsappE164, message);
  
  if (result.success) {
    // Atualiza status do booking
    await db.doc(`bookings/${booking.id}`).update({
      whatsappStatus: 'sent',
      confirmationSentAt: FieldValue.serverTimestamp(),
    });
    return { sent: true, queued: false };
  }
  
  // Falhou - adiciona à fila de retry
  await addToQueue(db, booking, 'confirmation', message);
  return { sent: false, queued: true, error: result.error };
}

/**
 * Envia confirmação de cancelamento
 */
export async function sendCancellationConfirmation(
  db: Firestore,
  env: Env,
  booking: BookingData,
  baseUrl: string
): Promise<{ sent: boolean; queued: boolean; error?: string }> {
  const settings = await getNotificationSettings(db);
  
  const message = await buildCancellationMessage(db, booking, settings.cancellationMessage, baseUrl);
  
  const result = await sendWhatsAppMessage(env, booking.customer.whatsappE164, message);
  
  if (result.success) {
    return { sent: true, queued: false };
  }
  
  // Falhou - adiciona à fila de retry
  await addToQueue(db, booking, 'cancellation', message);
  return { sent: false, queued: true, error: result.error };
}

/**
 * Envia lembrete de agendamento
 */
export async function sendBookingReminder(
  db: Firestore,
  env: Env,
  booking: BookingData
): Promise<{ sent: boolean; queued: boolean; error?: string }> {
  const settings = await getNotificationSettings(db);
  
  if (!settings.reminderEnabled) {
    return { sent: false, queued: false };
  }
  
  const message = await buildReminderMessage(db, booking, settings.reminderMessage);
  
  const result = await sendWhatsAppMessage(env, booking.customer.whatsappE164, message);
  
  if (result.success) {
    // Marca lembrete como enviado
    await db.doc(`bookings/${booking.id}`).update({
      reminderSentAt: FieldValue.serverTimestamp(),
    });
    return { sent: true, queued: false };
  }
  
  // Falhou - adiciona à fila de retry
  await addToQueue(db, booking, 'reminder', message);
  return { sent: false, queued: true, error: result.error };
}

/**
 * Processa fila de retry - tenta reenviar mensagens pendentes
 */
export async function processMessageQueue(
  db: Firestore,
  env: Env,
  limit: number = 10
): Promise<{ processed: number; sent: number; failed: number }> {
  const snap = await db
    .collection(MESSAGE_QUEUE_COLLECTION)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();
  
  let sent = 0;
  let failed = 0;
  
  for (const doc of snap.docs) {
    const item = doc.data() as WhatsAppMessageQueue;
    
    const result = await sendWhatsAppMessage(env, item.phoneE164, item.messageText);
    
    if (result.success) {
      await doc.ref.update({
        status: 'sent',
        sentAt: FieldValue.serverTimestamp(),
        attempts: FieldValue.increment(1),
        lastAttemptAt: FieldValue.serverTimestamp(),
      });
      sent++;
    } else {
      const newAttempts = (item.attempts || 0) + 1;
      const newStatus = newAttempts >= item.maxAttempts ? 'failed' : 'pending';
      
      await doc.ref.update({
        status: newStatus,
        attempts: newAttempts,
        lastAttemptAt: FieldValue.serverTimestamp(),
        lastError: result.error,
      });
      
      if (newStatus === 'failed') {
        failed++;
      }
    }
  }
  
  return { processed: snap.docs.length, sent, failed };
}

/**
 * Busca agendamentos que precisam de lembrete
 */
export async function getBookingsForReminder(
  db: Firestore
): Promise<BookingData[]> {
  const settings = await getNotificationSettings(db);
  
  if (!settings.reminderEnabled) {
    return [];
  }
  
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const reminderWindowStart = now.toJSDate();
  const reminderWindowEnd = now.plus({ minutes: settings.reminderMinutesBefore + 5 }).toJSDate();
  
  // Busca bookings:
  // - Status 'booked' (não cancelado, não completed)
  // - slotStart entre agora e (agora + reminderMinutes + 5min de margem)
  // - Sem reminderSentAt (lembrete ainda não enviado)
  const snap = await db
    .collection('bookings')
    .where('status', '==', 'booked')
    .where('slotStart', '>=', Timestamp.fromDate(reminderWindowStart))
    .where('slotStart', '<=', Timestamp.fromDate(reminderWindowEnd))
    .get();
  
  const bookings: BookingData[] = [];
  
  for (const doc of snap.docs) {
    const data = doc.data();
    
    // Pula se já enviou lembrete
    if (data.reminderSentAt) continue;
    
    bookings.push({
      id: doc.id,
      customerId: data.customerId,
      barberId: data.barberId,
      serviceType: data.serviceType,
      slotStart: data.slotStart?.toDate() || new Date(),
      customer: data.customer,
    });
  }
  
  return bookings;
}

/**
 * Processa envio de lembretes para todos os agendamentos elegíveis
 */
export async function processReminders(
  db: Firestore,
  env: Env
): Promise<{ processed: number; sent: number; queued: number }> {
  const bookings = await getBookingsForReminder(db);
  
  let sent = 0;
  let queued = 0;
  
  for (const booking of bookings) {
    const result = await sendBookingReminder(db, env, booking);
    if (result.sent) sent++;
    if (result.queued) queued++;
  }
  
  return { processed: bookings.length, sent, queued };
}
