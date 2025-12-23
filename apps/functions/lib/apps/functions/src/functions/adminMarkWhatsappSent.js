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
exports.adminMarkWhatsappSent = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const admin_1 = require("../utils/admin");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.adminMarkWhatsappSent = functions.https.onCall(async (data, context) => {
    try {
        const { bookingId } = data;
        if (!bookingId || typeof bookingId !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'bookingId é obrigatório');
        }
        // Buscar booking
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Reserva não encontrada');
        }
        const bookingData = bookingDoc.data();
        // Verificar permissão
        (0, admin_1.requireBarberOrOwner)(context, bookingData.barberId);
        // Atualizar booking e customer
        await db.runTransaction(async (transaction) => {
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
    }
    catch (error) {
        functions.logger.error('Error marking WhatsApp as sent', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Erro ao marcar WhatsApp como enviado. Tente novamente.');
    }
});
//# sourceMappingURL=adminMarkWhatsappSent.js.map