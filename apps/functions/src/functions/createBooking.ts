import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  createBookingRequestSchema,
  normalizeToE164,
  generateCustomerId,
  getDateKey,
  isSunday,
  isValidTimeSlot,
  generateSlotId,
} from '@sr-cardoso/shared';
import { DateTime } from 'luxon';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const createBooking = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/357c9bd1-4379-4fa7-9403-e26cfba69bae', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H3',
        location: 'apps/functions/src/functions/createBooking.ts:createBooking:entry',
        message: 'createBooking called (raw)',
        data: {
          hasAuth: !!context?.auth,
          keys: Array.isArray(Object.keys(data ?? {})) ? Object.keys(data ?? {}).slice(0, 10) : [],
          hasCustomer: !!(data as any)?.customer,
          hasBarberId: typeof (data as any)?.barberId === 'string',
          hasServiceType: typeof (data as any)?.serviceType === 'string',
          slotStartType: typeof (data as any)?.slotStart,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    // Validar entrada
    const validated = createBookingRequestSchema.parse(data);
    
    // Normalizar WhatsApp para E.164
    const whatsappE164 = normalizeToE164(validated.customer.whatsapp);
    
    // Converter slotStart para DateTime
    const slotStart = DateTime.fromISO(validated.slotStart, { zone: 'America/Sao_Paulo' });
    
    // Validações de negócio
    if (isSunday(slotStart)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Não é possível agendar aos domingos. A barbearia está fechada.'
      );
    }
    
    if (!isValidTimeSlot(slotStart)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Horário inválido. A barbearia funciona das 08:00 às 18:30, com intervalos de 30 minutos.'
      );
    }
    
    // Verificar se barbeiro existe e está ativo
    const barberRef = db.collection('barbers').doc(validated.barberId);
    const barberDoc = await barberRef.get();
    
    if (!barberDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'Barbeiro não encontrado'
      );
    }
    
    const barberData = barberDoc.data();
    if (!barberData?.active) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Este barbeiro não está disponível no momento'
      );
    }
    
    // Gerar IDs
    const customerId = generateCustomerId(whatsappE164);
    const slotId = generateSlotId(slotStart);
    const dateKey = getDateKey(slotStart);
    const bookingId = db.collection('bookings').doc().id;
    
    // Transação: criar slot + booking + upsert customer
    const result = await db.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
      const slotRef = db
        .collection('barbers')
        .doc(validated.barberId)
        .collection('slots')
        .doc(slotId);
      
      const slotDoc = await transaction.get(slotRef);
      
      // Se slot já existe, retornar erro de conflito
      if (slotDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Este horário já foi reservado. Por favor, selecione outro horário.'
        );
      }
      
      // Criar slot
      transaction.set(slotRef, {
        slotStart: admin.firestore.Timestamp.fromDate(slotStart.toJSDate()),
        dateKey,
        kind: 'booking',
        bookingId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Criar booking
      const bookingRef = db.collection('bookings').doc(bookingId);
      transaction.set(bookingRef, {
        customerId,
        barberId: validated.barberId,
        serviceType: validated.serviceType,
        slotStart: admin.firestore.Timestamp.fromDate(slotStart.toJSDate()),
        dateKey,
        customer: {
          firstName: validated.customer.firstName,
          lastName: validated.customer.lastName,
          whatsappE164,
        },
        status: 'booked',
        whatsappStatus: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Upsert customer
      const customerRef = db.collection('customers').doc(customerId);
      const customerDoc = await transaction.get(customerRef);
      
      const now = admin.firestore.Timestamp.now();
      
      if (!customerDoc.exists) {
        // Criar novo customer
        transaction.set(customerRef, {
          identity: {
            firstName: validated.customer.firstName,
            lastName: validated.customer.lastName,
            whatsappE164,
          },
          profile: {
            birthday: validated.customer.birthDate || null,
          },
          consent: {
            marketingOptIn: false,
          },
          stats: {
            firstBookingAt: now,
            lastBookingAt: now,
            totalBookings: 1,
            totalCompleted: 0,
            noShowCount: 0,
          },
        });
      } else {
        // Atualizar customer existente
        const updates: Record<string, any> = {
          'identity.firstName': validated.customer.firstName,
          'identity.lastName': validated.customer.lastName,
          'stats.lastBookingAt': now,
          'stats.totalBookings': admin.firestore.FieldValue.increment(1),
        };

        if (validated.customer.birthDate) {
          updates['profile.birthday'] = validated.customer.birthDate;
        }

        transaction.update(customerRef, updates);
      }
      
      return { bookingId, customerId };
    });
    
    functions.logger.info('Booking created', {
      bookingId: result.bookingId,
      customerId: result.customerId,
      barberId: validated.barberId,
      slotStart: validated.slotStart,
    });
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/357c9bd1-4379-4fa7-9403-e26cfba69bae', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H3',
        location: 'apps/functions/src/functions/createBooking.ts:createBooking:success',
        message: 'createBooking success',
        data: {
          barberId: validated.barberId,
          serviceType: validated.serviceType,
          dateKey,
          slotId,
          bookingId: result.bookingId,
          whatsappE164Len: typeof whatsappE164 === 'string' ? whatsappE164.length : null,
          whatsappE164StartsWithPlus: typeof whatsappE164 === 'string' ? whatsappE164.startsWith('+') : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return {
      success: true,
      bookingId: result.bookingId,
      message: 'Agendamento criado com sucesso',
    };
  } catch (error: any) {
    functions.logger.error('Error creating booking', error);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/357c9bd1-4379-4fa7-9403-e26cfba69bae', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H3',
        location: 'apps/functions/src/functions/createBooking.ts:createBooking:catch',
        message: 'createBooking error',
        data: {
          errorName: error?.name ?? null,
          errorCode: error?.code ?? null,
          isHttpsError: error instanceof functions.https.HttpsError,
          errorMessage: error?.message ?? null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    if (error.name === 'ZodError') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Dados inválidos: ' + error.errors.map((e: any) => e.message).join(', ')
      );
    }
    
    throw new functions.https.HttpsError(
      'internal',
      'Erro ao criar agendamento. Tente novamente.'
    );
  }
});

