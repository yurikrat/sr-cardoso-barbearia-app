/**
 * Normaliza número de telefone brasileiro para formato E.164
 * Implementação local (mesma lógica do shared)
 */
export function normalizeToE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('55') && digits.length >= 12) {
    return `+${digits}`;
  }

  const withoutLeadingZero = digits.startsWith('0') ? digits.slice(1) : digits;

  if (withoutLeadingZero.length === 10 || withoutLeadingZero.length === 11) {
    const normalized =
      withoutLeadingZero.length === 11
        ? withoutLeadingZero.slice(0, 2) + withoutLeadingZero.slice(3)
        : withoutLeadingZero;

    return `+55${normalized}`;
  }

  if (digits.length >= 12 && digits.startsWith('55')) {
    return `+${digits}`;
  }

  throw new Error('Formato de telefone inválido');
}

/**
 * Aplica máscara brasileira ao número de telefone
 */
export function applyPhoneMask(value: string): string {
  const digits = value.replace(/\D/g, '');
  
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 7) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

/**
 * Formata número para exibição no padrão (DD) 99999-9999
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  const withoutCountry = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  return applyPhoneMask(withoutCountry);
}

/**
 * Normaliza número brasileiro para E.164 (usa função do shared)
 */
