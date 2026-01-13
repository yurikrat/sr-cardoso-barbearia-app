import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { generateSlotsBetween } from './dates';

const TIMEZONE = 'America/Sao_Paulo';

describe('generateSlotsBetween', () => {
  it('deve gerar 4 slots para bloqueio 17:00-19:00 (17:00, 17:30, 18:00, 18:30)', () => {
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 17, minute: 0 });
    const end = baseDate.set({ hour: 19, minute: 0 });

    const slots = generateSlotsBetween(start, end);

    expect(slots).toHaveLength(4);
    expect(slots.map(s => s.toFormat('HH:mm'))).toEqual(['17:00', '17:30', '18:00', '18:30']);
  });

  it('deve gerar 3 slots para bloqueio 17:00-18:30 (17:00, 17:30, 18:00)', () => {
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 17, minute: 0 });
    const end = baseDate.set({ hour: 18, minute: 30 });

    const slots = generateSlotsBetween(start, end);

    expect(slots).toHaveLength(3);
    expect(slots.map(s => s.toFormat('HH:mm'))).toEqual(['17:00', '17:30', '18:00']);
  });

  it('não deve truncar 18:30 para 18:00 - bloqueio até 19:00 inclui 18:30', () => {
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 18, minute: 0 });
    const end = baseDate.set({ hour: 19, minute: 0 });

    const slots = generateSlotsBetween(start, end);

    expect(slots).toHaveLength(2);
    expect(slots.map(s => s.toFormat('HH:mm'))).toEqual(['18:00', '18:30']);
    // Verificação explícita de que 18:30 está incluído
    expect(slots.some(s => s.hour === 18 && s.minute === 30)).toBe(true);
  });

  it('deve ser end-exclusive (endTime não é incluído como slot)', () => {
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 8, minute: 0 });
    const end = baseDate.set({ hour: 9, minute: 0 });

    const slots = generateSlotsBetween(start, end);

    // 08:00 e 08:30 devem ser incluídos, mas 09:00 NÃO
    expect(slots).toHaveLength(2);
    expect(slots.map(s => s.toFormat('HH:mm'))).toEqual(['08:00', '08:30']);
  });

  it('deve retornar array vazio quando start >= end', () => {
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 10, minute: 0 });
    const end = baseDate.set({ hour: 10, minute: 0 });

    const slots = generateSlotsBetween(start, end);

    expect(slots).toHaveLength(0);
  });

  it('deve gerar slots corretamente para dia inteiro 09:00-19:30 (21 slots)', () => {
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 9, minute: 0 });
    const end = baseDate.set({ hour: 19, minute: 30 });

    const slots = generateSlotsBetween(start, end);

    expect(slots).toHaveLength(21);
    expect(slots[0].toFormat('HH:mm')).toBe('09:00');
    expect(slots[slots.length - 1].toFormat('HH:mm')).toBe('19:00');
  });

  it('bloqueio 17:00-19:00 não deve deixar 18:30-19:00 livre', () => {
    // Cenário: usuário bloqueia das 17:00 até 19:00
    // Esperado: slots 17:00, 17:30, 18:00, 18:30 são bloqueados
    // O slot 18:30 deve estar na lista (não deve sobrar livre)
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 17, minute: 0 });
    const end = baseDate.set({ hour: 19, minute: 0 });

    const blockedSlots = generateSlotsBetween(start, end);
    const blockedTimes = blockedSlots.map(s => s.toFormat('HH:mm'));

    // Deve ter exatamente 4 slots bloqueados
    expect(blockedSlots).toHaveLength(4);
    
    // Todos os slots de 30min entre 17:00 e 19:00 devem estar bloqueados
    expect(blockedTimes).toContain('17:00');
    expect(blockedTimes).toContain('17:30');
    expect(blockedTimes).toContain('18:00');
    expect(blockedTimes).toContain('18:30');
    
    // 19:00 NÃO deve estar na lista (é o endTime exclusive)
    expect(blockedTimes).not.toContain('19:00');
  });

  it('deve garantir cobertura completa sem vazamentos entre slots', () => {
    // Testa que todos os slots de 30min estão cobertos sem gaps
    const baseDate = DateTime.fromISO('2024-01-15', { zone: TIMEZONE });
    const start = baseDate.set({ hour: 14, minute: 0 });
    const end = baseDate.set({ hour: 16, minute: 0 });

    const slots = generateSlotsBetween(start, end);

    // Verifica sequência contínua de 30min
    for (let i = 1; i < slots.length; i++) {
      const diff = slots[i].diff(slots[i - 1], 'minutes').minutes;
      expect(diff).toBe(30);
    }

    // Primeiro slot = start, último slot = end - 30min
    expect(slots[0].toFormat('HH:mm')).toBe('14:00');
    expect(slots[slots.length - 1].toFormat('HH:mm')).toBe('15:30');
  });
});
