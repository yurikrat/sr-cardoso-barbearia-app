import { DateTime } from 'luxon';
import type { Firestore } from '@google-cloud/firestore';

export const OWNER_BARBER_ID = 'sr-cardoso';
export const FINANCE_CONFIG_DOC_PATH = 'settings/finance';

export type ServiceCatalogItem = {
  id: string;
  label: string;
  priceCents: number;
  active: boolean;
  sortOrder: number;
};

/**
 * Preço de serviço específico por barbeiro.
 * Quando não definido, usa-se o preço global do serviço.
 */
export type BarberServicePriceOverride = {
  serviceId: string;
  priceCents: number;
};

export type FinanceConfig = {
  commissions: {
    defaultBarberPct: number;
    ownerBarberPct: number;
  };
  services: ServiceCatalogItem[];
  /** 
   * Preços específicos por barbeiro. Chave: barberId.
   * Exemplo: { 'sr-cardoso': [{ serviceId: 'cabelo', priceCents: 5000 }] }
   */
  barberServicePrices?: Record<string, BarberServicePriceOverride[]>;
};

function normalizeServiceId(input: string): string | null {
  const id = input.trim().toLowerCase();
  if (!id) return null;
  // Permitimos underscore por compat com "cabelo_barba".
  if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(id)) return null;
  return id;
}

function clampPct(input: unknown, fallback: number): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  // Aceita tanto 0.45 quanto 45.
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

function getDefaultServicePriceCentsFromEnv(serviceId: string): number {
  const cabelo = Number(process.env.PRICE_CABELO_CENTS ?? '4500');
  const barba = Number(process.env.PRICE_BARBA_CENTS ?? '4000');
  const sobrancelha = Number(process.env.PRICE_SOBRANCELHA_CENTS ?? '1000');
  const combo = Number(process.env.PRICE_CABELO_BARBA_CENTS ?? '7000');
  const comboSobrancelha = Number(process.env.PRICE_CABELO_SOBRANCELHA_CENTS ?? '5500');

  if (serviceId === 'cabelo') return Number.isFinite(cabelo) ? cabelo : 4500;
  if (serviceId === 'barba') return Number.isFinite(barba) ? barba : 4000;
  if (serviceId === 'sobrancelha') return Number.isFinite(sobrancelha) ? sobrancelha : 1000;
  if (serviceId === 'cabelo_barba') return Number.isFinite(combo) ? combo : 7000;
  if (serviceId === 'cabelo_sobrancelha') return Number.isFinite(comboSobrancelha) ? comboSobrancelha : 5500;
  return 0;
}

export function getDefaultFinanceConfig(): FinanceConfig {
  return {
    commissions: {
      defaultBarberPct: 0.45,
      // Dono (Sr. Cardoso) não divide com a barbearia: 100% do valor é do profissional.
      ownerBarberPct: 1,
    },
    services: [
      {
        id: 'cabelo',
        label: 'Cabelo',
        priceCents: getDefaultServicePriceCentsFromEnv('cabelo'),
        active: true,
        sortOrder: 10,
      },
      {
        id: 'barba',
        label: 'Barba',
        priceCents: getDefaultServicePriceCentsFromEnv('barba'),
        active: true,
        sortOrder: 20,
      },
      {
        id: 'sobrancelha',
        label: 'Sobrancelha',
        priceCents: getDefaultServicePriceCentsFromEnv('sobrancelha'),
        active: true,
        sortOrder: 25,
      },
      {
        id: 'cabelo_barba',
        label: 'Cabelo + Barba',
        priceCents: getDefaultServicePriceCentsFromEnv('cabelo_barba'),
        active: true,
        sortOrder: 30,
      },
      {
        id: 'cabelo_sobrancelha',
        label: 'Cabelo + Sobrancelha',
        priceCents: getDefaultServicePriceCentsFromEnv('cabelo_sobrancelha'),
        active: true,
        sortOrder: 35,
      },
    ],
  };
}

export function sanitizeFinanceConfig(input: unknown): FinanceConfig {
  const base = getDefaultFinanceConfig();
  const obj = input && typeof input === 'object' ? (input as any) : {};

  const commissionsObj = obj.commissions && typeof obj.commissions === 'object' ? obj.commissions : {};
  const defaultBarberPct = clampPct(commissionsObj.defaultBarberPct, base.commissions.defaultBarberPct);
  // Mantemos a chave por compat, mas o dono sempre fica com 100%.
  const ownerBarberPct = 1;

  const servicesRaw = Array.isArray(obj.services) ? obj.services : base.services;
  const services: ServiceCatalogItem[] = [];
  const seen = new Set<string>();

  for (const it of servicesRaw) {
    const item = it && typeof it === 'object' ? (it as any) : null;
    const id =
      normalizeServiceId(typeof item?.id === 'string' ? item.id : '') ??
      normalizeServiceId(typeof item?.serviceType === 'string' ? item.serviceType : '');
    if (!id || seen.has(id)) continue;
    const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : id;
    const priceCents = Math.max(0, Math.round(Number(item?.priceCents ?? 0)));
    const active = typeof item?.active === 'boolean' ? item.active : true;
    const sortOrder = Number.isFinite(Number(item?.sortOrder)) ? Math.round(Number(item?.sortOrder)) : 0;
    services.push({ id, label, priceCents, active, sortOrder });
    seen.add(id);
  }

  // Garantir que pelo menos os 3 padrões existem (compat)
  for (const d of base.services) {
    if (!seen.has(d.id)) {
      services.push(d);
      seen.add(d.id);
    }
  }

  services.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  // Processar barberServicePrices
  const barberServicePrices: Record<string, BarberServicePriceOverride[]> = {};
  const rawBarberPrices = obj.barberServicePrices && typeof obj.barberServicePrices === 'object' ? obj.barberServicePrices : {};
  
  for (const barberId of Object.keys(rawBarberPrices)) {
    const overrides = rawBarberPrices[barberId];
    if (!Array.isArray(overrides)) continue;
    
    const validOverrides: BarberServicePriceOverride[] = [];
    for (const ov of overrides) {
      if (!ov || typeof ov !== 'object') continue;
      const serviceId = normalizeServiceId(typeof ov.serviceId === 'string' ? ov.serviceId : '');
      if (!serviceId) continue;
      const priceCents = Math.max(0, Math.round(Number(ov.priceCents ?? 0)));
      validOverrides.push({ serviceId, priceCents });
    }
    
    if (validOverrides.length > 0) {
      barberServicePrices[barberId] = validOverrides;
    }
  }

  return { commissions: { defaultBarberPct, ownerBarberPct }, services, barberServicePrices };
}

let financeConfigCache: { value: FinanceConfig; fetchedAtMs: number } | null = null;
const FINANCE_CONFIG_TTL_MS = 30_000;

export async function getFinanceConfig(db: Firestore): Promise<FinanceConfig> {
  const now = Date.now();
  if (financeConfigCache && now - financeConfigCache.fetchedAtMs < FINANCE_CONFIG_TTL_MS) {
    return financeConfigCache.value;
  }

  try {
    const ref = db.doc(FINANCE_CONFIG_DOC_PATH);
    const snap = await ref.get();
    const cfg = snap.exists ? sanitizeFinanceConfig(snap.data()) : getDefaultFinanceConfig();
    financeConfigCache = { value: cfg, fetchedAtMs: now };
    return cfg;
  } catch (e) {
    console.warn('[server] Failed to load finance config; using defaults:', e);
    const cfg = getDefaultFinanceConfig();
    financeConfigCache = { value: cfg, fetchedAtMs: now };
    return cfg;
  }
}

export function setFinanceConfigCache(config: FinanceConfig) {
  financeConfigCache = { value: config, fetchedAtMs: Date.now() };
}

export function getServiceFromConfig(config: FinanceConfig, serviceId: string): ServiceCatalogItem | null {
  const normalized = normalizeServiceId(serviceId) ?? serviceId;
  return config.services.find((s) => s.id === normalized) ?? null;
}

export function getServicePriceCentsFromConfig(config: FinanceConfig, serviceId: string): number {
  const s = getServiceFromConfig(config, serviceId);
  return s ? s.priceCents : 0;
}

/**
 * Obtém o preço de um serviço para um barbeiro específico.
 * Primeiro verifica se há override para o barbeiro, senão usa o preço global.
 */
export function getServicePriceCentsForBarber(config: FinanceConfig, serviceId: string, barberId: string): number {
  const normalized = normalizeServiceId(serviceId) ?? serviceId;
  
  // Verificar se há preço específico para este barbeiro
  const barberOverrides = config.barberServicePrices?.[barberId];
  if (barberOverrides) {
    const override = barberOverrides.find((o) => o.serviceId === normalized);
    if (override) {
      return override.priceCents;
    }
  }
  
  // Fallback para preço global
  return getServicePriceCentsFromConfig(config, serviceId);
}

export function getBarberCommissionPct(config: FinanceConfig, barberId: string): number {
  // Dono (Sr. Cardoso) sempre fica com 100%.
  return barberId === OWNER_BARBER_ID ? 1 : config.commissions.defaultBarberPct;
}

export type PopularityResult = {
  winnerServiceId: string | null;
  countsByServiceType: Record<string, number>;
  window: { startKey: string; endKey: string };
};

export async function computeServicesPopularityLast90Days(db: Firestore, config: FinanceConfig): Promise<PopularityResult> {
  type PopularityCache = {
    fetchedAtMs: number;
    winnerServiceId: string | null;
    countsByServiceType: Record<string, number>;
    window: { startKey: string; endKey: string };
  };

  const POPULARITY_TTL_MS = 10 * 60 * 1000;
  const nowMs = Date.now();

  const nowSP = DateTime.now().setZone('America/Sao_Paulo');
  const endKey = nowSP.toFormat('yyyy-MM-dd');
  const startKey = nowSP.minus({ days: 90 }).toFormat('yyyy-MM-dd');

  const anyGlobal = globalThis as any;
  const cached: PopularityCache | null = anyGlobal.__servicesPopularityCache ?? null;

  if (
    cached &&
    nowMs - cached.fetchedAtMs < POPULARITY_TTL_MS &&
    cached.window.startKey === startKey &&
    cached.window.endKey === endKey
  ) {
    return { winnerServiceId: cached.winnerServiceId, countsByServiceType: cached.countsByServiceType, window: cached.window };
  }

  const snap = await db
    .collection('bookings')
    .where('dateKey', '>=', startKey)
    .where('dateKey', '<=', endKey)
    .get();

  const counts: Record<string, number> = {};
  let total = 0;

  snap.forEach((doc) => {
    const data = doc.data() as any;
    const status = typeof data.status === 'string' ? data.status : 'unknown';
    if (!['booked', 'confirmed', 'completed'].includes(status)) return;
    const serviceType = typeof data.serviceType === 'string' ? data.serviceType : null;
    if (!serviceType) return;
    counts[serviceType] = (counts[serviceType] ?? 0) + 1;
    total += 1;
  });

  const activeServices = (config.services ?? []).filter((s) => s.active);
  const getSortOrder = (id: string) => activeServices.find((s) => s.id === id)?.sortOrder ?? 0;
  const getLabel = (id: string) => activeServices.find((s) => s.id === id)?.label ?? id;

  let winnerServiceId: string | null = null;

  if (activeServices.length > 0) {
    if (total > 0) {
      let bestId = activeServices[0].id;
      let bestCount = counts[bestId] ?? 0;
      let bestPrice = activeServices[0].priceCents;

      for (const s of activeServices) {
        const c = counts[s.id] ?? 0;
        const p = s.priceCents;
        if (c > bestCount) {
          bestId = s.id;
          bestCount = c;
          bestPrice = p;
          continue;
        }
        if (c === bestCount && p > bestPrice) {
          bestId = s.id;
          bestPrice = p;
          continue;
        }
        if (c === bestCount && p === bestPrice) {
          const aOrder = getSortOrder(bestId);
          const bOrder = s.sortOrder;
          if (bOrder < aOrder) {
            bestId = s.id;
            continue;
          }
          if (bOrder === aOrder) {
            const aLabel = getLabel(bestId);
            const bLabel = s.label;
            if (bLabel.localeCompare(aLabel, 'pt-BR') < 0) bestId = s.id;
          }
        }
      }
      winnerServiceId = bestId;
    } else {
      // Fallback sem dados: maior valor.
      let bestId = activeServices[0].id;
      let bestPrice = activeServices[0].priceCents;
      for (const s of activeServices) {
        if (s.priceCents > bestPrice) {
          bestId = s.id;
          bestPrice = s.priceCents;
          continue;
        }
        if (s.priceCents === bestPrice) {
          const aOrder = getSortOrder(bestId);
          const bOrder = s.sortOrder;
          if (bOrder < aOrder) {
            bestId = s.id;
            continue;
          }
          if (bOrder === aOrder) {
            const aLabel = getLabel(bestId);
            const bLabel = s.label;
            if (bLabel.localeCompare(aLabel, 'pt-BR') < 0) bestId = s.id;
          }
        }
      }
      winnerServiceId = bestId;
    }
  }

  const result: PopularityResult = {
    winnerServiceId,
    countsByServiceType: counts,
    window: { startKey, endKey },
  };

  anyGlobal.__servicesPopularityCache = {
    fetchedAtMs: nowMs,
    winnerServiceId,
    countsByServiceType: counts,
    window: { startKey, endKey },
  } satisfies PopularityCache;

  return result;
}
