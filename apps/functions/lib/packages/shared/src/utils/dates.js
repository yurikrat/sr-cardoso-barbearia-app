"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNow = getNow;
exports.toSaoPauloTime = toSaoPauloTime;
exports.getDateKey = getDateKey;
exports.isSunday = isSunday;
exports.generateSlotId = generateSlotId;
exports.isValidTimeSlot = isValidTimeSlot;
exports.generateSlotsBetween = generateSlotsBetween;
exports.extractBirthdayMmdd = extractBirthdayMmdd;
const luxon_1 = require("luxon");
const TIMEZONE = 'America/Sao_Paulo';
/**
 * Obtém DateTime no timezone de São Paulo
 */
function getNow() {
    return luxon_1.DateTime.now().setZone(TIMEZONE);
}
/**
 * Converte timestamp para DateTime no timezone de São Paulo
 */
function toSaoPauloTime(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return luxon_1.DateTime.fromJSDate(date, { zone: TIMEZONE });
}
/**
 * Gera dateKey no formato YYYY-MM-DD
 */
function getDateKey(date) {
    const dt = date instanceof luxon_1.DateTime ? date : toSaoPauloTime(date);
    return dt.toFormat('yyyy-MM-dd');
}
/**
 * Verifica se é domingo
 */
function isSunday(date) {
    const dt = date instanceof luxon_1.DateTime ? date : toSaoPauloTime(date);
    return dt.weekday === 7; // Luxon: 1 = Monday, 7 = Sunday
}
/**
 * Gera slotId no formato YYYYMMDD_HHmm
 */
function generateSlotId(slotStart) {
    const dt = slotStart instanceof luxon_1.DateTime ? slotStart : toSaoPauloTime(slotStart);
    return dt.toFormat('yyyyMMdd_HHmm');
}
/**
 * Valida se o horário está dentro da faixa permitida (08:00 - 18:30)
 */
function isValidTimeSlot(slotStart) {
    const dt = slotStart instanceof luxon_1.DateTime ? slotStart : toSaoPauloTime(slotStart);
    const hour = dt.hour;
    const minute = dt.minute;
    // Antes das 08:00
    if (hour < 8) {
        return false;
    }
    // Depois das 18:30
    if (hour > 18 || (hour === 18 && minute > 30)) {
        return false;
    }
    // Deve ser múltiplo de 30 minutos
    if (minute !== 0 && minute !== 30) {
        return false;
    }
    return true;
}
/**
 * Gera todos os slots de 30min entre startTime e endTime
 */
function generateSlotsBetween(startTime, endTime) {
    const start = startTime instanceof luxon_1.DateTime ? startTime : toSaoPauloTime(startTime);
    const end = endTime instanceof luxon_1.DateTime ? endTime : toSaoPauloTime(endTime);
    const slots = [];
    let current = start;
    while (current <= end) {
        slots.push(current);
        current = current.plus({ minutes: 30 });
    }
    return slots;
}
/**
 * Extrai MMDD de uma data de aniversário
 */
function extractBirthdayMmdd(birthday) {
    // birthday está no formato YYYY-MM-DD
    const parts = birthday.split('-');
    if (parts.length !== 3) {
        throw new Error('Formato de data inválido. Use YYYY-MM-DD');
    }
    return `${parts[1]}${parts[2]}`; // MM + DD
}
//# sourceMappingURL=dates.js.map