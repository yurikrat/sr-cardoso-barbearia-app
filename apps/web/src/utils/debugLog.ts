type DebugPayload = {
  sessionId: string;
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
};

const ENDPOINT =
  // Usar path relativo (com proxy do Vite) para evitar CORS no browser
  '/ingest/357c9bd1-4379-4fa7-9403-e26cfba69bae';

/**
 * Log de debug (best-effort). Não lança erro, não envia PII/segredos.
 */
export function debugLog(payload: DebugPayload) {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
      return;
    }
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', body }).catch(() => {});
  } catch {
    // ignore
  }
}


