import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { requireBarberOrOwner } from '../utils/admin';
import { generateSlotId } from '@sr-cardoso/shared';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const adminCancelBooking = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
  try {
    requireBarberOrOwner(context, data.barberId);
    
    const { bookingId } = data;
    
    if (!bookingId || typeof bookingId !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'bookingId é obrigatório'
      );
    }
    
    // Buscar booking
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Reserva não encontrada');
    }
    
    const bookingData = bookingDoc.data()!;
    
    // Verificar permissão (barber só pode cancelar própria agenda)
    requireBarberOrOwner(context, bookingData.barberId);
    
    // Verificar se já está cancelado
    if (bookingData.status === 'cancelled') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Esta reserva já está cancelada'
      );
    }
    
    // Transação: atualizar booking + remover slot + atualizar stats
    await db.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
      // Atualizar booking
      transaction.update(bookingRef, {
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Remover slot
      const slotId = generateSlotId(bookingData.slotStart.toDate());
      const slotRef = db
        .collection('barbers')
        .doc(bookingData.barberId)
        .collection('slots')
        .doc(slotId);
      
      transaction.delete(slotRef);
      
      // Atualizar stats do customer
      const customerRef = db.collection('customers').doc(bookingData.customerId);
      transaction.update(customerRef, {
        'stats.totalBookings': admin.firestore.FieldValue.increment(-1),
      });
    });
    
    functions.logger.info('Booking cancelled', { bookingId });
    
    return {
      success: true,
      message: 'Reserva cancelada com sucesso',
    };
  } catch (error: any) {
    functions.logger.error('Error cancelling booking', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError(
      'internal',
      'Erro ao cancelar reserva. Tente novamente.'
    );
  }
});

