import type { Env } from './env.js';

export type EvolutionJson = Record<string, unknown>;

export type EvolutionRequestError = {
  status: number;
  message: string;
  url: string;
  method: string;
  bodySnippet?: string;
};

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, '');
}

function buildUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (path.startsWith('/')) return `${base}${path}`;
  return `${base}/${path}`;
}

function maskUrlForLogs(url: string): string {
  // Base URL may contain internal IP; that's OK. Never include apikey in URL anyway.
  return url;
}

async function readTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export type EvolutionClient = {
  get: (path: string) => Promise<EvolutionJson>;
  post: (path: string, body: unknown) => Promise<EvolutionJson>;
};

export function createEvolutionClient(env: Env): EvolutionClient {
  const baseUrl = env.EVOLUTION_BASE_URL ? normalizeBaseUrl(env.EVOLUTION_BASE_URL) : '';
  const apiKey = env.EVOLUTION_API_KEY ?? '';

  const ensureConfigured = () => {
    if (!baseUrl) {
      const err: EvolutionRequestError = {
        status: 500,
        message: 'EVOLUTION_BASE_URL não configurado',
        url: '(missing)',
        method: 'CONFIG',
      };
      throw err;
    }
    if (!apiKey) {
      const err: EvolutionRequestError = {
        status: 500,
        message: 'EVOLUTION_API_KEY não configurado',
        url: maskUrlForLogs(baseUrl),
        method: 'CONFIG',
      };
      throw err;
    }
  };

  const request = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    ensureConfigured();

    const url = buildUrl(baseUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const headers: Record<string, string> = {
        apikey: apiKey,
      };

      let fetchBody: string | undefined;
      if (method === 'POST') {
        headers['content-type'] = 'application/json';
        fetchBody = JSON.stringify(body ?? {});
      }

      const res = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: controller.signal,
      });

      const text = await readTextSafe(res);
      let json: EvolutionJson = {};
      if (text) {
        try {
          json = JSON.parse(text) as EvolutionJson;
        } catch {
          // keep json empty
        }
      }

      if (!res.ok) {
        const msg =
          (typeof (json as any)?.error === 'string' && (json as any).error) ||
          (typeof (json as any)?.message === 'string' && (json as any).message) ||
          `Erro ao chamar Evolution (HTTP ${res.status})`;

        const err: EvolutionRequestError = {
          status: res.status,
          message: msg,
          url: maskUrlForLogs(url),
          method,
          bodySnippet: text ? text.slice(0, 400) : undefined,
        };
        throw err;
      }

      return json;
    } catch (e: any) {
      if (e && typeof e === 'object' && typeof e.status === 'number' && typeof e.message === 'string') {
        throw e;
      }
      const err: EvolutionRequestError = {
        status: 502,
        message: e?.name === 'AbortError' ? 'Timeout ao chamar Evolution' : 'Falha ao chamar Evolution',
        url: maskUrlForLogs(buildUrl(baseUrl || '(missing)', path)),
        method,
      };
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}

export function getEvolutionInstanceName(env: Env): string {
  const name = (env.EVOLUTION_INSTANCE_NAME ?? '').trim();
  if (!name) throw new Error('EVOLUTION_INSTANCE_NAME não configurado');
  return name;
}

export function toEvolutionNumber(toE164: string): string {
  // Evolution costuma aceitar número com DDI+DDD+numero, sem '+' (ex.: 557998016908)
  return String(toE164 || '').trim().replace(/^\+/, '').replace(/\s+/g, '');
}

export function extractQrBase64(payload: unknown): string | null {
  const obj = payload as any;
  const candidates = [
    obj?.qrcode?.base64,
    obj?.qrCode?.base64,
    obj?.qrcode,
    obj?.base64,
    obj?.data?.qrcode?.base64,
    obj?.data?.qrCode?.base64,
    obj?.data?.qrcode,
    obj?.data?.base64,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

export function extractPairingCode(payload: unknown): string | null {
  const obj = payload as any;
  const candidates = [
    obj?.pairingCode,
    obj?.code,
    obj?.pairing?.code,
    obj?.data?.pairingCode,
    obj?.data?.code,
    obj?.data?.pairing?.code,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

export function extractConnectionState(payload: unknown): string | null {
  const obj = payload as any;
  const candidates = [obj?.state, obj?.connectionState, obj?.status, obj?.data?.state, obj?.data?.connectionState];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}
