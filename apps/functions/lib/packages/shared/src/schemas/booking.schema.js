"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBookingRequestSchema = exports.whatsappStatusSchema = exports.bookingStatusSchema = exports.serviceTypeSchema = void 0;
const zod_1 = require("zod");
exports.serviceTypeSchema = zod_1.z.enum(['cabelo', 'barba', 'cabelo_barba']);
exports.bookingStatusSchema = zod_1.z.enum([
    'booked',
    'confirmed',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled',
]);
exports.whatsappStatusSchema = zod_1.z.enum(['pending', 'sent']);
exports.createBookingRequestSchema = zod_1.z.object({
    barberId: zod_1.z.string().min(1),
    serviceType: exports.serviceTypeSchema,
    slotStart: zod_1.z.string().datetime(), // ISO 8601
    customer: zod_1.z.object({
        firstName: zod_1.z.string().min(2).max(50),
        lastName: zod_1.z.string().min(2).max(50),
        whatsapp: zod_1.z.string().min(10), // Será normalizado para E.164
    }),
});
//# sourceMappingURL=booking.schema.js.map