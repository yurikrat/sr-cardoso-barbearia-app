/**
 * Utilitários de validação
 */

/**
 * Valida se um email é válido
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valida se um nome é válido (mínimo 2 caracteres, apenas letras e espaços)
 */
export function isValidName(name: string): boolean {
  if (name.length < 2) return false;
  const nameRegex = /^[a-zA-ZÀ-ÿ\s]+$/;
  return nameRegex.test(name);
}

/**
 * Valida se um telefone brasileiro é válido (com ou sem máscara)
 */
export function isValidBrazilianPhone(phone: string): boolean {
  // Remove caracteres não numéricos
  let cleanPhone = phone.replace(/\D/g, '');
  
  // Se começar com 55, remove para validar o resto
  if (cleanPhone.startsWith('55') && cleanPhone.length >= 12) {
    cleanPhone = cleanPhone.slice(2);
  }

  // Deve ter 10 ou 11 dígitos (fixo ou celular)
  if (cleanPhone.length < 10 || cleanPhone.length > 11) return false;
  
  // Celular deve começar com 9 (após DDD)
  if (cleanPhone.length === 11 && cleanPhone[2] !== '9') return false;
  
  return true;
}

/**
 * Valida se uma data não é no passado
 */
export function isNotPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate >= today;
}

/**
 * Valida se uma data não é domingo
 */
export function isNotSunday(date: Date): boolean {
  return date.getDay() !== 0;
}

