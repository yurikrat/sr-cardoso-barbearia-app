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
exports.barberCalendarIcs = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const luxon_1 = require("luxon");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
/**
 * Gera feed iCal (ICS) para a agenda do barbeiro
 * URL: /ical/barber/{barberId}/{calendarFeedToken}.ics
 */
exports.barberCalendarIcs = functions.https.onRequest(async (req, res) => {
    try {
        // Extrair parâmetros da URL: /ical/barber/{barberId}/{calendarFeedToken}.ics
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 4 || pathParts[0] !== 'ical' || pathParts[1] !== 'barber') {
            res.status(400).send('URL inválida. Use: /ical/barber/{barberId}/{token}.ics');
            return;
        }
        const barberId = pathParts[2];
        const calendarFeedToken = pathParts[3].replace('.ics', '');
        if (!barberId || !calendarFeedToken) {
            res.status(400).send('Parâmetros inválidos');
            return;
        }
        // Buscar barbeiro pelo token
        const barberRef = db.collection('barbers').doc(barberId);
        const barberDoc = await barberRef.get();
        if (!barberDoc.exists) {
            res.status(404).send('Barbeiro não encontrado');
            return;
        }
        const barberData = barberDoc.data();
        if (barberData.calendarFeedToken !== calendarFeedToken) {
            res.status(403).send('Token inválido');
            return;
        }
        // Buscar bookings futuros do barbeiro
        const now = admin.firestore.Timestamp.now();
        const bookingsSnapshot = await db
            .collection('bookings')
            .where('barberId', '==', barberId)
            .where('slotStart', '>=', now)
            .where('status', 'in', ['booked', 'confirmed'])
            .orderBy('slotStart', 'asc')
            .get();
        // Gerar ICS
        const icsLines = [];
        icsLines.push('BEGIN:VCALENDAR');
        icsLines.push('VERSION:2.0');
        icsLines.push('PRODID:-//Sr Cardoso Barbearia//Agenda//PT');
        icsLines.push('CALSCALE:GREGORIAN');
        icsLines.push('METHOD:PUBLISH');
        bookingsSnapshot.forEach((doc) => {
            const booking = doc.data();
            const slotStart = booking.slotStart.toDate();
            const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000); // +30 min
            const dtStart = formatICSDate(slotStart);
            const dtEnd = formatICSDate(slotEnd);
            // Título sem PII completo (apenas "Atendimento - 30min")
            const summary = `Atendimento - 30min`;
            icsLines.push('BEGIN:VEVENT');
            icsLines.push(`UID:${doc.id}@sr-cardoso-barbearia`);
            icsLines.push(`DTSTART:${dtStart}`);
            icsLines.push(`DTEND:${dtEnd}`);
            icsLines.push(`SUMMARY:${escapeICS(summary)}`);
            icsLines.push(`DESCRIPTION:${escapeICS(`Serviço: ${booking.serviceType}`)}`);
            icsLines.push('STATUS:CONFIRMED');
            icsLines.push('END:VEVENT');
        });
        icsLines.push('END:VCALENDAR');
        const icsContent = icsLines.join('\r\n');
        // Headers
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="agenda-${barberId}.ics"`);
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache de 5 minutos
        res.status(200).send(icsContent);
    }
    catch (error) {
        functions.logger.error('Error generating ICS', error);
        res.status(500).send('Erro ao gerar calendário');
    }
});
/**
 * Formata data para formato ICS (YYYYMMDDTHHmmssZ)
 */
function formatICSDate(date) {
    const dt = luxon_1.DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' });
    return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}
/**
 * Escapa caracteres especiais para ICS
 */
function escapeICS(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}
//# sourceMappingURL=barberCalendarIcs.js.map