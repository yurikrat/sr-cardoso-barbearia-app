"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRescheduleBooking = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const admin_1 = require("../utils/admin");
const shared_1 = require("@sr-cardoso/shared");
const luxon_1 = require("luxon");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.adminRescheduleBooking = functions.https.onCall(async (data, context) => {
    try {
        const { bookingId, newSlotStart } = data;
        if (!bookingId || typeof bookingId !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'bookingId é obrigatório');
        }
        if (!newSlotStart || typeof newSlotStart !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'newSlotStart é obrigatório (ISO 8601)');
        }
        // Buscar booking atual
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Reserva não encontrada');
        }
        const bookingData = bookingDoc.data();
        // Verificar permissão
        (0, admin_1.requireBarberOrOwner)(context, bookingData.barberId);
        // Validar novo slot
        const newSlot = luxon_1.DateTime.fromISO(newSlotStart, { zone: 'America/Sao_Paulo' });
        if ((0, shared_1.isSunday)(newSlot)) {
            throw new functions.https.HttpsError('invalid-argument', 'Não é possível reagendar para domingo');
        }
        if (!(0, shared_1.isValidTimeSlot)(newSlot)) {
            throw new functions.https.HttpsError('invalid-argument', 'Horário inválido. A barbearia funciona das 08:00 às 18:30, com intervalos de 30 minutos.');
        }
        const newSlotId = (0, shared_1.generateSlotId)(newSlot);
        const newDateKey = (0, shared_1.getDateKey)(newSlot);
        const oldSlotId = (0, shared_1.generateSlotId)(bookingData.slotStart.toDate());
        // Transação: criar novo slot, remover slot antigo, atualizar booking
        await db.runTransaction(async (transaction) => {
            // Verificar se novo slot já existe
            const newSlotRef = db
                .collection('barbers')
                .doc(bookingData.barberId)
                .collection('slots')
                .doc(newSlotId);
            const newSlotDoc = await transaction.get(newSlotRef);
            if (newSlotDoc.exists) {
                throw new functions.https.HttpsError('already-exists', 'Este horário já está ocupado');
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
    }
    catch (error) {
        functions.logger.error('Error rescheduling booking', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Erro ao reagendar reserva. Tente novamente.');
    }
});
//# sourceMappingURL=adminRescheduleBooking.js.map