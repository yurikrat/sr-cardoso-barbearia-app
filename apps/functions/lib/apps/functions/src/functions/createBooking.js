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
exports.createBooking = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const shared_1 = require("@sr-cardoso/shared");
const luxon_1 = require("luxon");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.createBooking = functions.https.onCall(async (data, context) => {
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
                    hasCustomer: !!data?.customer,
                    hasBarberId: typeof data?.barberId === 'string',
                    hasServiceType: typeof data?.serviceType === 'string',
                    slotStartType: typeof data?.slotStart,
                },
                timestamp: Date.now(),
            }),
        }).catch(() => { });
        // #endregion
        // Validar entrada
        const validated = shared_1.createBookingRequestSchema.parse(data);
        // Normalizar WhatsApp para E.164
        const whatsappE164 = (0, shared_1.normalizeToE164)(validated.customer.whatsapp);
        // Converter slotStart para DateTime
        const slotStart = luxon_1.DateTime.fromISO(validated.slotStart, { zone: 'America/Sao_Paulo' });
        // Validações de negócio
        if ((0, shared_1.isSunday)(slotStart)) {
            throw new functions.https.HttpsError('invalid-argument', 'Não é possível agendar aos domingos. A barbearia está fechada.');
        }
        if (!(0, shared_1.isValidTimeSlot)(slotStart)) {
            throw new functions.https.HttpsError('invalid-argument', 'Horário inválido. A barbearia funciona das 08:00 às 18:30, com intervalos de 30 minutos.');
        }
        // Verificar se barbeiro existe e está ativo
        const barberRef = db.collection('barbers').doc(validated.barberId);
        const barberDoc = await barberRef.get();
        if (!barberDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Barbeiro não encontrado');
        }
        const barberData = barberDoc.data();
        if (!barberData?.active) {
            throw new functions.https.HttpsError('invalid-argument', 'Este barbeiro não está disponível no momento');
        }
        // Gerar IDs
        const customerId = (0, shared_1.generateCustomerId)(whatsappE164);
        const slotId = (0, shared_1.generateSlotId)(slotStart);
        const dateKey = (0, shared_1.getDateKey)(slotStart);
        const bookingId = db.collection('bookings').doc().id;
        // Transação: criar slot + booking + upsert customer
        const result = await db.runTransaction(async (transaction) => {
            const slotRef = db
                .collection('barbers')
                .doc(validated.barberId)
                .collection('slots')
                .doc(slotId);
            const slotDoc = await transaction.get(slotRef);
            // Se slot já existe, retornar erro de conflito
            if (slotDoc.exists) {
                throw new functions.https.HttpsError('already-exists', 'Este horário já foi reservado. Por favor, selecione outro horário.');
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
                    profile: {},
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
            }
            else {
                // Atualizar customer existente
                transaction.update(customerRef, {
                    'identity.firstName': validated.customer.firstName,
                    'identity.lastName': validated.customer.lastName,
                    'stats.lastBookingAt': now,
                    'stats.totalBookings': admin.firestore.FieldValue.increment(1),
                });
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
        }).catch(() => { });
        // #endregion
        return {
            success: true,
            bookingId: result.bookingId,
            message: 'Agendamento criado com sucesso',
        };
    }
    catch (error) {
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
        }).catch(() => { });
        // #endregion
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        if (error.name === 'ZodError') {
            throw new functions.https.HttpsError('invalid-argument', 'Dados inválidos: ' + error.errors.map((e) => e.message).join(', '));
        }
        throw new functions.https.HttpsError('internal', 'Erro ao criar agendamento. Tente novamente.');
    }
});
//# sourceMappingURL=createBooking.js.map