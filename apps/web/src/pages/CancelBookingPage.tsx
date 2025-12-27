import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function CancelBookingPage() {
  const { branding } = useBranding();
  const { cancelCode } = useParams<{ cancelCode: string }>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canCancel = useMemo(() => {
    if (!cancelCode) return false;
    if (cancelCode.length < 8 || cancelCode.length > 128) return false;
    return true;
  }, [cancelCode]);

  const handleConfirmCancel = async () => {
    if (!cancelCode || !canCancel) return;
    setStatus('loading');
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/public/cancel/${encodeURIComponent(cancelCode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const text = await res.text();
      const json = text ? (JSON.parse(text) as { error?: string; success?: boolean }) : null;

      if (!res.ok) {
        throw new Error(json?.error || `Erro HTTP ${res.status}`);
      }

      setStatus('success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      setErrorMessage(msg);
      setStatus('error');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 safe-top-p4 safe-bottom-p4 overflow-x-hidden">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-4">
          <Link to="/" className="inline-block" aria-label="Ir para a página inicial">
            <img 
              src={branding?.logoUrl || "/logo.png"} 
              alt="Sr. Cardoso Barbearia" 
              className="mx-auto w-40 h-auto" 
              style={{ transform: `scale(${branding?.logoScale || 1})` }}
            />
          </Link>
          <h1 className="text-2xl font-serif font-bold text-foreground">Cancelar agendamento</h1>
          <p className="text-muted-foreground">Confirme abaixo para cancelar seu agendamento.</p>
        </div>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-serif">Confirmação</CardTitle>
            <CardDescription>
              Ao cancelar, o horário será liberado e você pode reagendar quando quiser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canCancel ? (
              <div className="text-sm text-destructive">Link inválido.</div>
            ) : status === 'success' ? (
              <div className="space-y-3">
                <div className="text-sm">✅ Agendamento cancelado com sucesso.</div>
                <Link to="/agendar" className="block">
                  <Button className="w-full">Agendar novamente</Button>
                </Link>
              </div>
            ) : (
              <>
                {status === 'error' && errorMessage ? (
                  <div className="text-sm text-destructive">{errorMessage}</div>
                ) : null}

                <Button
                  className="w-full"
                  variant="destructive"
                  onClick={handleConfirmCancel}
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? 'Cancelando...' : 'Confirmar cancelamento'}
                </Button>

                <Link to="/" className="block">
                  <Button className="w-full" variant="secondary">
                    Voltar
                  </Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
