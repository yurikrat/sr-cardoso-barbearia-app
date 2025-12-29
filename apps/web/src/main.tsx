import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function renderFatalError(rootEl: HTMLElement, error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : 'Erro desconhecido ao carregar a aplicação.';

  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#0b0c0d;color:#eaeaea;font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
      <div style="max-width:720px;width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:16px;">
        <div style="font-weight:700;margin-bottom:6px;">Não foi possível carregar o painel</div>
        <div style="opacity:0.85;font-size:13px;margin-bottom:12px;">O app encontrou um erro ao iniciar. Tente recarregar a página. Se continuar, envie esta mensagem para o suporte.</div>
        <pre style="white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.35);padding:12px;border-radius:10px;font-size:12px;line-height:1.35;">${message}</pre>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="app_reload" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#eaeaea;cursor:pointer;">Recarregar</button>
          <button id="app_hard_reload" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#eaeaea;cursor:pointer;">Recarregar (sem cache)</button>
        </div>
      </div>
    </div>
  `;

  try {
    rootEl.querySelector('#app_reload')?.addEventListener('click', () => window.location.reload());
    rootEl
      .querySelector('#app_hard_reload')
      ?.addEventListener('click', () => window.location.replace(`${window.location.pathname}?r=${Date.now()}`));
  } catch {
    // ignore
  }
}

async function bootstrap() {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element #root não encontrado');

  // Immediate feedback instead of blank screen during bundle load.
  rootEl.innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0c0d;color:#eaeaea;font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">Carregando…</div>';

  const { default: App } = await import('./App.tsx');
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap().catch((err) => {
  const rootEl = document.getElementById('root') || document.body;
  renderFatalError(rootEl as HTMLElement, err);
});
