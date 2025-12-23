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
exports.adminBlockSlots = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const admin_1 = require("../utils/admin");
const shared_1 = require("@sr-cardoso/shared");
const luxon_1 = require("luxon");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.adminBlockSlots = functions.https.onCall(async (data, context) => {
    try {
        const { barberId, startTime, endTime, reason } = data;
        if (!barberId || typeof barberId !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'barberId é obrigatório');
        }
        if (!startTime || typeof startTime !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'startTime é obrigatório (ISO 8601)');
        }
        if (!endTime || typeof endTime !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'endTime é obrigatório (ISO 8601)');
        }
        // Verificar permissão
        (0, admin_1.requireBarberOrOwner)(context, barberId);
        // Validar horários
        const start = luxon_1.DateTime.fromISO(startTime, { zone: 'America/Sao_Paulo' });
        const end = luxon_1.DateTime.fromISO(endTime, { zone: 'America/Sao_Paulo' });
        if (end <= start) {
            throw new functions.https.HttpsError('invalid-argument', 'endTime deve ser posterior a startTime');
        }
        if ((0, shared_1.isSunday)(start) || (0, shared_1.isSunday)(end)) {
            throw new functions.https.HttpsError('invalid-argument', 'Não é possível bloquear horários aos domingos');
        }
        if (!(0, shared_1.isValidTimeSlot)(start) || !(0, shared_1.isValidTimeSlot)(end)) {
            throw new functions.https.HttpsError('invalid-argument', 'Horários inválidos. A barbearia funciona das 08:00 às 18:30, com intervalos de 30 minutos.');
        }
        // Gerar slots de 30min no intervalo
        const slots = (0, shared_1.generateSlotsBetween)(start, end);
        if (slots.length === 0) {
            throw new functions.https.HttpsError('invalid-argument', 'Nenhum slot válido no intervalo especificado');
        }
        // Criar todos os slots bloqueados
        const batch = db.batch();
        const createdSlots = [];
        for (const slot of slots) {
            const slotId = (0, shared_1.generateSlotId)(slot);
            const dateKey = (0, shared_1.getDateKey)(slot);
            const slotRef = db
                .collection('barbers')
                .doc(barberId)
                .collection('slots')
                .doc(slotId);
            // Verificar se já existe (não sobrescrever bookings)
            const slotDoc = await slotRef.get();
            if (slotDoc.exists) {
                const existingData = slotDoc.data();
                if (existingData.kind === 'booking') {
                    throw new functions.https.HttpsError('failed-precondition', `O horário ${slot.toFormat('HH:mm')} já está reservado`);
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
    }
    catch (error) {
        functions.logger.error('Error blocking slots', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Erro ao bloquear horários. Tente novamente.');
    }
});
//# sourceMappingURL=adminBlockSlots.js.map