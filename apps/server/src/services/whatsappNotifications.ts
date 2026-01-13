import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import { DateTime } from 'luxon';
import { createEvolutionClient, getEvolutionInstanceName, toEvolutionNumber, type EvolutionRequestError } from '../lib/evolutionApi.js';
import type { Env } from '../lib/env.js';
import { getFinanceConfig, getServiceFromConfig } from '../lib/finance.js';
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
      confirmationMessage: 'Tudo certo! Seu horário está reservado. Chega uns 5 minutinhos antes pra gente te atender com calma.',
      reminderEnabled: true,
      reminderMinutesBefore: 60,
      reminderMessage: 'Falta pouco pro seu horário! Te vejo daqui a pouco aqui na barbearia.',
      cancellationMessage: 'Cancelado! Quando quiser reagendar, é só clicar no link abaixo. Vai ser um prazer te atender.',
      birthdayEnabled: true,
      birthdayMessage: 'Feliz aniversário! 🎂🎉 A Barbearia Sr. Cardoso deseja a você um dia incrível cheio de alegrias. Como presente, que tal passar aqui pra ficar ainda mais bonito? Te esperamos!',
    };
  }
  const data = doc.data() as WhatsAppNotificationSettings;
  // Garante defaults para novos campos se não existirem
  return {
    ...data,
    birthdayEnabled: data.birthdayEnabled ?? true,
    birthdayMessage: data.birthdayMessage ?? 'Feliz aniversário! 🎂🎉 A Barbearia Sr. Cardoso deseja a você um dia incrível cheio de alegrias. Como presente, que tal passar aqui pra ficar ainda mais bonito? Te esperamos!',
  };
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
  const config = await getFinanceConfig(db);
  const service = getServiceFromConfig(config, serviceType);
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
    `E aí, ${booking.customer.firstName}! ✂️`,
    '',
    customMessage,
    '',
    `*${serviceName}* com ${barberName}`,
    `📅 ${data}`,
    `🕐 ${hora}`,
    '',
    'Precisa mudar algo? Sem problema:',
    cancelLink,
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
    `${booking.customer.firstName}, bora? ⏰`,
    '',
    customMessage,
    '',
    `Seu horário: *${hora}*`,
    `Serviço: ${serviceName}`,
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
    `${booking.customer.firstName}, tudo bem!`,
    '',
    customMessage,
    '',
    'Novo agendamento:',
    `${baseUrl}/agendar`,
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
  
  const cancelLink = `${baseUrl}/cancelar/${cancelCode}`;
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

/**
 * Constrói mensagem de aniversário personalizada
 */
function buildBirthdayMessage(
  firstName: string,
  customMessage: string,
  baseUrl: string
): string {
  const lines = [
    `Olá, ${firstName}! 🎉`,
    '',
    customMessage,
    '',
    '📅 Agende seu horário especial:',
    `${baseUrl}/agendar`,
  ];
  
  return lines.join('\n');
}

/**
 * Busca clientes que fazem aniversário hoje
 */
export async function getCustomersWithBirthdayToday(
  db: Firestore
): Promise<Array<{ id: string; firstName: string; whatsappE164: string }>> {
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const todayMmdd = now.toFormat('MMdd'); // Ex: "0110" para 10 de janeiro
  
  // Busca clientes com birthdayMmdd igual a hoje
  const snap = await db
    .collection('customers')
    .where('profile.birthdayMmdd', '==', todayMmdd)
    .get();
  
  const customers: Array<{ id: string; firstName: string; whatsappE164: string }> = [];
  
  for (const doc of snap.docs) {
    const data = doc.data();
    const whatsappE164 = data.identity?.whatsappE164;
    const firstName = data.identity?.firstName || 'Cliente';
    
    if (whatsappE164 && typeof whatsappE164 === 'string' && whatsappE164.length > 10) {
      customers.push({ id: doc.id, firstName, whatsappE164 });
    }
  }
  
  return customers;
}

/**
 * Envia mensagem de aniversário para um cliente
 */
export async function sendBirthdayMessage(
  db: Firestore,
  env: Env,
  customer: { id: string; firstName: string; whatsappE164: string },
  baseUrl: string
): Promise<{ sent: boolean; error?: string }> {
  const settings = await getNotificationSettings(db);
  
  if (!settings.birthdayEnabled) {
    return { sent: false };
  }
  
  const message = buildBirthdayMessage(customer.firstName, settings.birthdayMessage, baseUrl);
  
  const result = await sendWhatsAppMessage(env, customer.whatsappE164, message);
  
  if (result.success) {
    // Registra que enviamos mensagem de aniversário este ano
    const now = DateTime.now().setZone('America/Sao_Paulo');
    await db.doc(`customers/${customer.id}`).update({
      'stats.lastBirthdaySentYear': now.year,
      'stats.lastContactAt': FieldValue.serverTimestamp(),
    });
    return { sent: true };
  }
  
  return { sent: false, error: result.error };
}

/**
 * Processa envio de mensagens de aniversário
 */
export async function processBirthdayMessages(
  db: Firestore,
  env: Env,
  baseUrl: string
): Promise<{ processed: number; sent: number; failed: number; skipped: number; noCustomers: boolean }> {
  const customers = await getCustomersWithBirthdayToday(db);
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const currentYear = now.year;
  const todayMmdd = now.toFormat('MMdd');
  
  // Se não há aniversariantes hoje
  if (customers.length === 0) {
    console.log(`[Birthday] Nenhum cliente aniversariando hoje (${todayMmdd})`);
    return { processed: 0, sent: 0, failed: 0, skipped: 0, noCustomers: true };
  }
  
  console.log(`[Birthday] Encontrados ${customers.length} cliente(s) aniversariando hoje (${todayMmdd})`);
  
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const customer of customers) {
    // Verifica se já enviamos mensagem de aniversário este ano
    const customerDoc = await db.doc(`customers/${customer.id}`).get();
    const lastBirthdaySentYear = customerDoc.data()?.stats?.lastBirthdaySentYear;
    
    if (lastBirthdaySentYear === currentYear) {
      console.log(`[Birthday] Pulando ${customer.firstName} (${customer.id}) - já recebeu este ano`);
      skipped++;
      continue;
    }
    
    const result = await sendBirthdayMessage(db, env, customer, baseUrl);
    
    if (result.sent) {
      console.log(`[Birthday] ✓ Mensagem enviada para ${customer.firstName} (${customer.id})`);
      sent++;
    } else {
      console.log(`[Birthday] ✗ Falha ao enviar para ${customer.firstName} (${customer.id}): ${result.error}`);
      failed++;
    }
    
    // Pequena pausa para não sobrecarregar a API
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  console.log(`[Birthday] Resumo: ${sent} enviado(s), ${failed} falha(s), ${skipped} pulado(s) de ${customers.length} aniversariante(s)`);
  
  return { processed: customers.length, sent, failed, skipped, noCustomers: false };
}

/**
 * Envia mensagem com mídia (imagem) via Evolution API
 * Suporta tanto URL quanto base64 (data:image/...)
 */
export async function sendWhatsAppMedia(
  env: Env,
  phoneE164: string,
  mediaUrlOrBase64: string,
  caption: string,
  mediaType: 'image' | 'document' = 'image'
): Promise<{ success: boolean; error?: string }> {
  try {
    const evo = createEvolutionClient(env);
    const instanceName = getEvolutionInstanceName(env);
    
    // Detecta se é base64 ou URL
    const isBase64 = mediaUrlOrBase64.startsWith('data:');
    
    await evo.post(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: toEvolutionNumber(phoneE164),
      mediatype: mediaType,
      media: mediaUrlOrBase64,
      caption,
      // Se for base64, podemos adicionar um filename
      ...(isBase64 && { fileName: `image_${Date.now()}.jpg` }),
    });
    
    return { success: true };
  } catch (e: any) {
    const err = e as EvolutionRequestError;
    const errorMsg = err?.message || 'Erro desconhecido ao enviar mídia';
    console.error('WhatsApp sendMedia error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Broadcast de mensagem com mídia para todos os clientes
 * Suporta tanto URL quanto base64 (data:image/...)
 */
export async function broadcastWithMedia(
  db: Firestore,
  env: Env,
  mediaUrlOrBase64: string,
  caption: string
): Promise<{ sent: number; failed: number; total: number; errors: Array<{ customerId: string; error: string }> }> {
  // Buscar todos os clientes com whatsappE164
  const customersSnap = await db.collection('customers').get();
  const customers: Array<{ id: string; firstName: string; whatsappE164: string }> = [];
  
  customersSnap.forEach((d) => {
    const data = d.data();
    const whatsappE164 = data.identity?.whatsappE164;
    const firstName = data.identity?.firstName || 'Cliente';
    
    if (whatsappE164 && typeof whatsappE164 === 'string' && whatsappE164.length > 10) {
      customers.push({ id: d.id, firstName, whatsappE164 });
    }
  });
  
  if (customers.length === 0) {
    return { sent: 0, failed: 0, total: 0, errors: [] };
  }
  
  let sent = 0;
  let failed = 0;
  const errors: Array<{ customerId: string; error: string }> = [];
  
  for (const customer of customers) {
    try {
      // Personalizar caption com nome do cliente
      const personalizedCaption = caption.replace(/\{nome\}/gi, customer.firstName);
      
      const result = await sendWhatsAppMedia(env, customer.whatsappE164, mediaUrlOrBase64, personalizedCaption);
      
      if (result.success) {
        sent++;
        // Atualiza último contato
        await db.doc(`customers/${customer.id}`).update({
          'stats.lastContactAt': FieldValue.serverTimestamp(),
        });
      } else {
        failed++;
        errors.push({ customerId: customer.id, error: result.error || 'Erro desconhecido' });
      }
      
      // Pausa para não sobrecarregar a API (800ms para mídia)
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (e: any) {
      failed++;
      errors.push({ customerId: customer.id, error: e?.message || 'Erro desconhecido' });
    }
  }
  
  console.log(`[Broadcast Media] Enviado: ${sent}/${customers.length}, Falhou: ${failed}`);
  
  return { sent, failed, total: customers.length, errors };
}

/**
 * Processa remarketing para clientes inativos (sem agendamento há X dias)
 * Envia mensagem convidando a agendar novamente
 */
export async function processInactiveCustomerRemarketing(
  db: Firestore,
  env: Env,
  baseUrl: string
): Promise<{ processed: number; sent: number; skipped: number; errors: Array<{ customerId: string; error: string }> }> {
  const settings = await getNotificationSettings(db);
  
  // Configurações de remarketing
  const INACTIVE_DAYS = 20; // Clientes sem agendamento há 20 dias
  const REMARKETING_COOLDOWN_DAYS = 20; // Não enviar mais de uma vez a cada 20 dias
  
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const inactiveThreshold = now.minus({ days: INACTIVE_DAYS }).toJSDate();
  const cooldownThreshold = now.minus({ days: REMARKETING_COOLDOWN_DAYS }).toJSDate();
  
  // Buscar todos os clientes
  const customersSnap = await db.collection('customers').get();
  
  const inactiveCustomers: Array<{
    id: string;
    firstName: string;
    whatsappE164: string;
    lastBookingAt?: Date;
    lastRemarketingAt?: Date;
    marketingOptIn?: boolean;
  }> = [];
  
  customersSnap.forEach((d) => {
    const data = d.data();
    const whatsappE164 = data.identity?.whatsappE164;
    const firstName = data.identity?.firstName || 'Cliente';
    
    if (!whatsappE164 || typeof whatsappE164 !== 'string' || whatsappE164.length < 10) {
      return; // Sem telefone válido
    }
    
    // Verificar se opt-in para marketing (default: true para compatibilidade)
    const marketingOptIn = data.consent?.marketingOptIn !== false;
    if (!marketingOptIn) {
      return; // Não quer receber marketing
    }
    
    // Verificar se está inativo
    let lastBookingAt: Date | undefined;
    if (data.stats?.lastCompletedAt) {
      lastBookingAt = data.stats.lastCompletedAt.toDate ? data.stats.lastCompletedAt.toDate() : new Date(data.stats.lastCompletedAt);
    } else if (data.stats?.lastBookingAt) {
      lastBookingAt = data.stats.lastBookingAt.toDate ? data.stats.lastBookingAt.toDate() : new Date(data.stats.lastBookingAt);
    }
    
    // Se nunca agendou ou o último agendamento foi há mais de 20 dias
    const isInactive = !lastBookingAt || lastBookingAt < inactiveThreshold;
    if (!isInactive) {
      return; // Cliente ativo
    }
    
    // Verificar cooldown de remarketing
    let lastRemarketingAt: Date | undefined;
    if (data.stats?.lastRemarketingAt) {
      lastRemarketingAt = data.stats.lastRemarketingAt.toDate ? data.stats.lastRemarketingAt.toDate() : new Date(data.stats.lastRemarketingAt);
    }
    
    if (lastRemarketingAt && lastRemarketingAt > cooldownThreshold) {
      return; // Já recebeu remarketing recentemente
    }
    
    inactiveCustomers.push({
      id: d.id,
      firstName,
      whatsappE164,
      lastBookingAt,
      lastRemarketingAt,
      marketingOptIn,
    });
  });
  
  if (inactiveCustomers.length === 0) {
    console.log('[Remarketing] Nenhum cliente inativo elegível');
    return { processed: 0, sent: 0, skipped: 0, errors: [] };
  }
  
  console.log(`[Remarketing] ${inactiveCustomers.length} clientes inativos elegíveis`);
  
  let sent = 0;
  let skipped = 0;
  const errors: Array<{ customerId: string; error: string }> = [];
  
  // Mensagem personalizada no estilo Sr. Cardoso
  const buildRemarketingMessage = (firstName: string): string => {
    const lines = [
      `E aí, ${firstName}! ✂️`,
      '',
      'Faz um tempinho que você não aparece aqui na Barbearia Sr. Cardoso. Tá tudo bem?',
      '',
      'Seu cabelo deve tá pedindo um trato, hein! 😄',
      '',
      'Bora marcar um horário? É rapidinho:',
      `${baseUrl}`,
      '',
      'Te espero! 🪒',
    ];
    return lines.join('\n');
  };
  
  for (const customer of inactiveCustomers) {
    try {
      const message = buildRemarketingMessage(customer.firstName);
      
      const result = await sendWhatsAppMessage(env, customer.whatsappE164, message);
      
      if (result.success) {
        sent++;
        // Atualiza timestamps
        await db.doc(`customers/${customer.id}`).update({
          'stats.lastContactAt': FieldValue.serverTimestamp(),
          'stats.lastRemarketingAt': FieldValue.serverTimestamp(),
        });
      } else {
        errors.push({ customerId: customer.id, error: result.error || 'Erro desconhecido' });
      }
      
      // Pausa de 500ms entre mensagens para não sobrecarregar
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (e: any) {
      errors.push({ customerId: customer.id, error: e?.message || 'Erro desconhecido' });
    }
  }
  
  console.log(`[Remarketing] Enviado: ${sent}/${inactiveCustomers.length}, Erros: ${errors.length}`);
  
  return {
    processed: inactiveCustomers.length,
    sent,
    skipped,
    errors,
  };
}

/**
 * Busca clientes aniversariantes hoje com informações de barbeiro
 * Agrupa por barbeiro baseado no último agendamento completado
 */
export async function getBirthdayCustomersGroupedByBarber(
  db: Firestore
): Promise<Map<string, Array<{ id: string; firstName: string; lastName: string; whatsappE164: string }>>> {
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const todayMmdd = now.toFormat('MMdd');
  
  // Busca clientes aniversariantes hoje
  const customersSnap = await db
    .collection('customers')
    .where('profile.birthdayMmdd', '==', todayMmdd)
    .get();
  
  if (customersSnap.empty) {
    return new Map();
  }
  
  // Map de barberId → lista de clientes
  const barberCustomers = new Map<string, Array<{ id: string; firstName: string; lastName: string; whatsappE164: string }>>();
  
  for (const customerDoc of customersSnap.docs) {
    const data = customerDoc.data();
    const whatsappE164 = data.identity?.whatsappE164;
    const firstName = data.identity?.firstName || 'Cliente';
    const lastName = data.identity?.lastName || '';
    
    if (!whatsappE164 || typeof whatsappE164 !== 'string' || whatsappE164.length < 10) {
      continue;
    }
    
    // Busca o último agendamento completado deste cliente para determinar o barbeiro
    const lastBookingSnap = await db
      .collection('bookings')
      .where('customerId', '==', customerDoc.id)
      .where('status', '==', 'completed')
      .orderBy('completedAt', 'desc')
      .limit(1)
      .get();
    
    let barberId = 'sr-cardoso'; // Default: Sr. Cardoso recebe todos sem histórico
    
    if (!lastBookingSnap.empty) {
      barberId = lastBookingSnap.docs[0].data().barberId || 'sr-cardoso';
    }
    
    const existing = barberCustomers.get(barberId) || [];
    existing.push({ id: customerDoc.id, firstName, lastName, whatsappE164 });
    barberCustomers.set(barberId, existing);
  }
  
  return barberCustomers;
}

/**
 * Busca telefone do barbeiro pelo seu barberId
 */
export async function getBarberPhoneE164(db: Firestore, barberId: string): Promise<string | null> {
  // Primeiro tenta buscar pelo adminUser vinculado ao barberId
  const adminSnap = await db
    .collection('adminUsers')
    .where('barberId', '==', barberId)
    .limit(1)
    .get();
  
  if (!adminSnap.empty) {
    const phone = adminSnap.docs[0].data().phoneE164;
    if (phone && typeof phone === 'string' && phone.length > 10) {
      return phone;
    }
  }
  
  // Fallback: tenta buscar direto pelo doc (para o caso do sr-cardoso)
  const directDoc = await db.doc(`adminUsers/${barberId}`).get();
  if (directDoc.exists) {
    const phone = directDoc.data()?.phoneE164;
    if (phone && typeof phone === 'string' && phone.length > 10) {
      return phone;
    }
  }
  
  return null;
}

/**
 * Constrói mensagem de alerta de aniversariantes para o barbeiro
 */
function buildBarberBirthdayAlertMessage(
  barberName: string,
  customers: Array<{ firstName: string; lastName: string; whatsappE164: string }>
): string {
  const lines = [
    `🎂 Bom dia, ${barberName}!`,
    '',
    `Seus clientes aniversariando hoje:`,
    '',
  ];
  
  for (const customer of customers) {
    const fullName = `${customer.firstName} ${customer.lastName}`.trim();
    // Formata o telefone para exibição legível
    const phoneDisplay = customer.whatsappE164.replace(/^(\+55)(\d{2})(\d{5})(\d{4})$/, '($2) $3-$4');
    lines.push(`• *${fullName}*`);
    lines.push(`  📞 ${phoneDisplay}`);
    lines.push('');
  }
  
  lines.push('💡 Dica: Liga ou manda uma mensagem parabenizando. Cliente bem tratado sempre volta! 🤝');
  
  return lines.join('\n');
}

/**
 * Envia alertas de aniversariantes para os barbeiros
 * Cada barbeiro recebe a lista dos SEUS clientes aniversariantes
 */
export async function sendBarberBirthdayAlerts(
  db: Firestore,
  env: Env
): Promise<{ barbersNotified: number; customersIncluded: number; errors: string[] }> {
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const todayMmdd = now.toFormat('MMdd');
  
  console.log(`[BirthdayAlert] Iniciando alertas de aniversariantes para barbeiros (${todayMmdd})`);
  
  const barberCustomers = await getBirthdayCustomersGroupedByBarber(db);
  
  if (barberCustomers.size === 0) {
    console.log(`[BirthdayAlert] Nenhum cliente aniversariando hoje`);
    return { barbersNotified: 0, customersIncluded: 0, errors: [] };
  }
  
  let barbersNotified = 0;
  let customersIncluded = 0;
  const errors: string[] = [];
  
  for (const [barberId, customers] of barberCustomers) {
    const barberPhone = await getBarberPhoneE164(db, barberId);
    
    if (!barberPhone) {
      errors.push(`Barbeiro ${barberId} sem telefone cadastrado`);
      console.log(`[BirthdayAlert] ⚠️ Barbeiro ${barberId} sem telefone - ${customers.length} cliente(s) não alertado(s)`);
      continue;
    }
    
    const barberName = await getBarberName(db, barberId);
    const message = buildBarberBirthdayAlertMessage(barberName, customers);
    
    const result = await sendWhatsAppMessage(env, barberPhone, message);
    
    if (result.success) {
      barbersNotified++;
      customersIncluded += customers.length;
      console.log(`[BirthdayAlert] ✓ ${barberName} notificado sobre ${customers.length} aniversariante(s)`);
    } else {
      errors.push(`Falha ao notificar ${barberName}: ${result.error}`);
      console.log(`[BirthdayAlert] ✗ Falha ao notificar ${barberName}: ${result.error}`);
    }
    
    // Pausa entre mensagens
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  console.log(`[BirthdayAlert] Resumo: ${barbersNotified} barbeiro(s) notificado(s), ${customersIncluded} cliente(s) incluído(s)`);
  
  return { barbersNotified, customersIncluded, errors };
}
