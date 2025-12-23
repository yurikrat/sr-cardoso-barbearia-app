import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { requireBarberOrOwner } from '../utils/admin';
import {
  isSunday,
  isValidTimeSlot,
  generateSlotsBetween,
  generateSlotId,
  getDateKey,
} from '@sr-cardoso/shared';
import { DateTime } from 'luxon';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const adminBlockSlots = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
  try {
    const { barberId, startTime, endTime, reason } = data;
    
    if (!barberId || typeof barberId !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'barberId é obrigatório'
      );
    }
    
    if (!startTime || typeof startTime !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'startTime é obrigatório (ISO 8601)'
      );
    }
    
    if (!endTime || typeof endTime !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'endTime é obrigatório (ISO 8601)'
      );
    }
    
    // Verificar permissão
    requireBarberOrOwner(context, barberId);
    
    // Validar horários
    const start = DateTime.fromISO(startTime, { zone: 'America/Sao_Paulo' });
    const end = DateTime.fromISO(endTime, { zone: 'America/Sao_Paulo' });
    
    if (end <= start) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'endTime deve ser posterior a startTime'
      );
    }
    
    if (isSunday(start) || isSunday(end)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Não é possível bloquear horários aos domingos'
      );
    }
    
    if (!isValidTimeSlot(start) || !isValidTimeSlot(end)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Horários inválidos. A barbearia funciona das 08:00 às 18:30, com intervalos de 30 minutos.'
      );
    }
    
    // Gerar slots de 30min no intervalo
    const slots = generateSlotsBetween(start, end);
    
    if (slots.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Nenhum slot válido no intervalo especificado'
      );
    }
    
    // Criar todos os slots bloqueados
    const batch = db.batch();
    const createdSlots: string[] = [];
    
    for (const slot of slots) {
      const slotId = generateSlotId(slot);
      const dateKey = getDateKey(slot);
      
      const slotRef = db
        .collection('barbers')
        .doc(barberId)
        .collection('slots')
        .doc(slotId);
      
      // Verificar se já existe (não sobrescrever bookings)
      const slotDoc = await slotRef.get();
      if (slotDoc.exists) {
        const existingData = slotDoc.data()!;
        if (existingData.kind === 'booking') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `O horário ${slot.toFormat('HH:mm')} já está reservado`
          );
        }
      }
      
      batch.set(slotRef, {
        slotStart: admin.firestore.Timestamp.fromDate(slot.toJSDate()),
        dateKey,
        kind: 'block',
        reason: reason || 'Horário bloqueado',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      createdSlots.push(slotId);
    }
    
    await batch.commit();
    
    functions.logger.info('Slots blocked', {
      barberId,
      startTime,
      endTime,
      slotsCount: createdSlots.length,
    });
    
    return {
      success: true,
      slotsCreated: createdSlots.length,
      message: `${createdSlots.length} horário(s) bloqueado(s) com sucesso`,
    };
  } catch (error: any) {
    functions.logger.error('Error blocking slots', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError(
      'internal',
      'Erro ao bloquear horários. Tente novamente.'
    );
  }
});

