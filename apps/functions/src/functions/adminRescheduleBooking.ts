import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { requireBarberOrOwner } from '../utils/admin';
import {
  isSunday,
  isValidTimeSlot,
  generateSlotId,
  getDateKey,
} from '@sr-cardoso/shared';
import { DateTime } from 'luxon';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const adminRescheduleBooking = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
  try {
    const { bookingId, newSlotStart } = data;
    
    if (!bookingId || typeof bookingId !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'bookingId é obrigatório'
      );
    }
    
    if (!newSlotStart || typeof newSlotStart !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'newSlotStart é obrigatório (ISO 8601)'
      );
    }
    
    // Buscar booking atual
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Reserva não encontrada');
    }
    
    const bookingData = bookingDoc.data()!;
    
    // Verificar permissão
    requireBarberOrOwner(context, bookingData.barberId);
    
    // Validar novo slot
    const newSlot = DateTime.fromISO(newSlotStart, { zone: 'America/Sao_Paulo' });
    
    if (isSunday(newSlot)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Não é possível reagendar para domingo'
      );
    }
    
    if (!isValidTimeSlot(newSlot)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Horário inválido. A barbearia funciona das 08:00 às 18:30, com intervalos de 30 minutos.'
      );
    }
    
    const newSlotId = generateSlotId(newSlot);
    const newDateKey = getDateKey(newSlot);
    const oldSlotId = generateSlotId(bookingData.slotStart.toDate());
    
    // Transação: criar novo slot, remover slot antigo, atualizar booking
    await db.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
      // Verificar se novo slot já existe
      const newSlotRef = db
        .collection('barbers')
        .doc(bookingData.barberId)
        .collection('slots')
        .doc(newSlotId);
      
      const newSlotDoc = await transaction.get(newSlotRef);
      
      if (newSlotDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Este horário já está ocupado'
        );
      }
      
      // Criar novo slot
      transaction.set(newSlotRef, {
        slotStart: admin.firestore.Timestamp.fromDate(newSlot.toJSDate()),
        dateKey: newDateKey,
        kind: 'booking',
        bookingId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Remover slot antigo
      const oldSlotRef = db
        .collection('barbers')
        .doc(bookingData.barberId)
        .collection('slots')
        .doc(oldSlotId);
      
      transaction.delete(oldSlotRef);
      
      // Atualizar booking
      transaction.update(bookingRef, {
        slotStart: admin.firestore.Timestamp.fromDate(newSlot.toJSDate()),
        dateKey: newDateKey,
        rescheduledFrom: bookingId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    
    functions.logger.info('Booking rescheduled', { bookingId, newSlotStart });
    
    return {
      success: true,
      message: 'Reserva reagendada com sucesso',
    };
  } catch (error: any) {
    functions.logger.error('Error rescheduling booking', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError(
      'internal',
      'Erro ao reagendar reserva. Tente novamente.'
    );
  }
});

