import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { requireBarberOrOwner } from '../utils/admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const adminMarkWhatsappSent = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
  try {
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
    
    // Verificar permissão
    requireBarberOrOwner(context, bookingData.barberId);
    
    // Atualizar booking e customer
    await db.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
      // Atualizar booking
      transaction.update(bookingRef, {
        whatsappStatus: 'sent',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Atualizar customer (lastContactAt)
      const customerRef = db.collection('customers').doc(bookingData.customerId);
      transaction.update(customerRef, {
        'stats.lastContactAt': admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    
    functions.logger.info('WhatsApp marked as sent', { bookingId });
    
    return {
      success: true,
      message: 'WhatsApp marcado como enviado',
    };
  } catch (error: any) {
    functions.logger.error('Error marking WhatsApp as sent', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError(
      'internal',
      'Erro ao marcar WhatsApp como enviado. Tente novamente.'
    );
  }
});

