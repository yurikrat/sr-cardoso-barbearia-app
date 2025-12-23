"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerStatsSchema = exports.customerConsentSchema = exports.customerProfileSchema = exports.customerIdentitySchema = void 0;
const zod_1 = require("zod");
exports.customerIdentitySchema = zod_1.z.object({
    firstName: zod_1.z.string().min(2).max(50),
    lastName: zod_1.z.string().min(2).max(50),
    whatsappE164: zod_1.z.string().regex(/^\+55\d{10,11}$/),
});
exports.customerProfileSchema = zod_1.z.object({
    birthday: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    birthdayMmdd: zod_1.z.string().regex(/^\d{4}$/).optional(),
    notes: zod_1.z.string().max(1000).optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.customerConsentSchema = zod_1.z.object({
    marketingOptIn: zod_1.z.boolean(),
    marketingOptInAt: zod_1.z.date().optional(),
    marketingOptOutAt: zod_1.z.date().optional(),
});
exports.customerStatsSchema = zod_1.z.object({
    firstBookingAt: zod_1.z.date().optional(),
    lastBookingAt: zod_1.z.date().optional(),
    lastCompletedAt: zod_1.z.date().optional(),
    totalBookings: zod_1.z.number().int().min(0),
    totalCompleted: zod_1.z.number().int().min(0),
    noShowCount: zod_1.z.number().int().min(0),
    lastContactAt: zod_1.z.date().optional(),
});
//# sourceMappingURL=customer.schema.js.map