"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeToE164 = normalizeToE164;
exports.generateCustomerId = generateCustomerId;
/**
 * Normaliza número de telefone brasileiro para formato E.164
 * Remove máscaras e adiciona código do país (+55)
 */
function normalizeToE164(phone) {
    // Remove tudo que não é dígito
    const digits = phone.replace(/\D/g, '');
    // Se já começa com 55, assume que está completo
    if (digits.startsWith('55') && digits.length >= 12) {
        return `+${digits}`;
    }
    // Se começa com 0, remove
    const withoutLeadingZero = digits.startsWith('0') ? digits.slice(1) : digits;
    // Se tem 10 ou 11 dígitos (sem código do país), adiciona +55
    if (withoutLeadingZero.length === 10 || withoutLeadingZero.length === 11) {
        // Remove o 9 do DDD se tiver (ex: 11987654321 -> 1187654321)
        const normalized = withoutLeadingZero.length === 11
            ? withoutLeadingZero.slice(0, 2) + withoutLeadingZero.slice(3)
            : withoutLeadingZero;
        return `+55${normalized}`;
    }
    // Se já está no formato correto, apenas adiciona +
    if (digits.length >= 12 && digits.startsWith('55')) {
        return `+${digits}`;
    }
    throw new Error('Formato de telefone inválido');
}
/**
 * Gera customerId determinístico a partir do WhatsApp E.164
 * Usa hash simples para evitar duplicatas
 */
function generateCustomerId(whatsappE164) {
    // Remove o + e normaliza
    const normalized = whatsappE164.replace(/[^0-9]/g, '');
    // Hash simples (em produção, usar crypto.createHash)
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `customer_${Math.abs(hash).toString(36)}`;
}
//# sourceMappingURL=phone.js.map