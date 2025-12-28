import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { api } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

function asDataUrl(base64OrDataUrl: string | null): string | null {
  if (!base64OrDataUrl) return null;
  const trimmed = base64OrDataUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

export default function WhatsappPage() {
  const { toast } = useToast();
  const claims = api.admin.getClaims();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const [status, setStatus] = useState<{
    instanceName: string;
    instanceExists: boolean;
    connectionState: string | null;
    checkedBy: 'connectionState' | 'fetchInstances' | 'unknown';
    hint?: string;
    configured?: boolean;
    missing?: Array<'EVOLUTION_BASE_URL' | 'EVOLUTION_API_KEY' | 'EVOLUTION_INSTANCE_NAME'>;
  } | null>(null);

  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const [connectMode, setConnectMode] = useState<'qr' | 'pairingCode'>('qr');
  const [pairingPhone, setPairingPhone] = useState('');

  const [toE164, setToE164] = useState('');
  const [text, setText] = useState('');

  const qrSrc = useMemo(() => asDataUrl(qrBase64), [qrBase64]);
  const canUseEvolution = !!status && status.configured !== false;

  const loadStatus = async () => {
    const data = await api.admin.whatsappStatus();
    setStatus(data);
  };

  useEffect(() => {
    (async () => {
      try {
        await loadStatus();
      } catch (e: any) {
        toast({
          title: 'Erro ao carregar status',
          description: e?.message || 'Não foi possível consultar o WhatsApp.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadStatus();
      toast({ title: 'Atualizado', description: 'Status do WhatsApp atualizado.' });
    } catch (e: any) {
      toast({
        title: 'Erro ao atualizar',
        description: e?.message || 'Não foi possível atualizar o status.',
        variant: 'destructive',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const onConnect = async () => {
    setConnecting(true);
    try {
      const data = await api.admin.whatsappConnect(
        connectMode === 'pairingCode'
          ? { mode: 'pairingCode', phoneNumber: pairingPhone.trim() }
          : { mode: 'qr' }
      );
      setQrBase64(data.qrcodeBase64 ?? null);
      setPairingCode(data.pairingCode ?? null);
      toast({
        title: connectMode === 'pairingCode' ? 'Código gerado' : 'QR gerado',
        description:
          connectMode === 'pairingCode'
            ? 'Use o código no WhatsApp para conectar o dispositivo.'
            : 'Escaneie o QR no WhatsApp para conectar.',
      });
    } catch (e: any) {
      toast({
        title: 'Erro ao conectar',
        description: e?.message || 'Não foi possível gerar o QR.',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const onSendTest = async () => {
    setSendingTest(true);
    try {
      if (!toE164.trim() || !text.trim()) {
        toast({
          title: 'Preencha os campos',
          description: 'Informe o número (E.164) e o texto.',
          variant: 'destructive',
        });
        return;
      }
      await api.admin.whatsappSendTest({ toE164: toE164.trim(), text: text.trim() });
      toast({ title: 'Enviado', description: 'Mensagem teste enviada.' });
    } catch (e: any) {
      toast({
        title: 'Erro ao enviar',
        description: e?.message || 'Não foi possível enviar a mensagem teste.',
        variant: 'destructive',
      });
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingSpinner />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-serif font-bold text-foreground">WhatsApp</h2>
            <p className="text-muted-foreground">Conexão e testes via Evolution.</p>
          </div>
          <Button onClick={onRefresh} disabled={refreshing} className="bg-primary hover:bg-primary/90">
            {refreshing ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
            Atualizar
          </Button>
        </div>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Estado atual da instância configurada no servidor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="font-medium">Instância:</span> {status?.instanceName || '-'}
            </div>
            <div>
              <span className="font-medium">Existe:</span> {status?.instanceExists ? 'Sim' : 'Não'}
            </div>
            <div>
              <span className="font-medium">Connection state:</span> {status?.connectionState || '-'}
            </div>
            <div>
              <span className="font-medium">Checado por:</span> {status?.checkedBy || 'unknown'}
            </div>
            {status?.hint ? <div className="text-xs text-muted-foreground">{status.hint}</div> : null}
            {status?.configured === false ? (
              <div className="text-xs text-destructive">
                Configuração incompleta no servidor: {(status.missing || []).join(', ') || 'EVOLUTION_*'}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Conectar</CardTitle>
            <CardDescription>Gera um QR Code para conectar a instância (somente master).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Modo</Label>
              <Select value={connectMode} onValueChange={(v) => setConnectMode(v as any)}>
                <SelectTrigger disabled={claims?.role !== 'master' || !canUseEvolution}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qr">QR Code</SelectItem>
                  <SelectItem value="pairingCode">Código (sem QR)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {connectMode === 'pairingCode' ? (
              <div className="space-y-2">
                <Label htmlFor="pairingPhone">Número (E.164)</Label>
                <Input
                  id="pairingPhone"
                  value={pairingPhone}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingPhone(e.target.value)}
                  placeholder="Ex: +5579999999999"
                  disabled={claims?.role !== 'master' || !canUseEvolution}
                />
                <div className="text-xs text-muted-foreground">
                  Dica: use o número do WhatsApp com DDI (ex.: +55...).
                </div>
              </div>
            ) : null}

            <Button
              onClick={onConnect}
              disabled={
                connecting ||
                claims?.role !== 'master' ||
                !canUseEvolution ||
                (connectMode === 'pairingCode' && !pairingPhone.trim())
              }
              className="bg-primary hover:bg-primary/90"
            >
              {connecting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              {connectMode === 'pairingCode' ? 'Gerar código' : 'Gerar QR'}
            </Button>

            {pairingCode ? (
              <div className="p-3 border border-primary/10 rounded-md bg-background/40 text-sm">
                <div className="font-medium">Pairing code</div>
                <div className="font-mono text-base break-all">{pairingCode}</div>
              </div>
            ) : null}

            {qrSrc ? (
              <div className="flex items-center justify-center p-4 border border-primary/10 rounded-md bg-background/40">
                <img src={qrSrc} alt="QR Code WhatsApp" className="max-h-72 w-auto" />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Nenhum QR gerado.</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Mensagem teste</CardTitle>
            <CardDescription>Envia um texto para um número E.164 (somente master).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="toE164">Número (E.164)</Label>
              <Input
                id="toE164"
                value={toE164}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToE164(e.target.value)}
                placeholder="Ex: +5579999999999"
                disabled={claims?.role !== 'master' || !canUseEvolution}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">Texto</Label>
              <Input
                id="text"
                value={text}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                placeholder="Mensagem de teste"
                disabled={claims?.role !== 'master' || !canUseEvolution}
              />
            </div>
            <Button
              onClick={onSendTest}
              disabled={sendingTest || claims?.role !== 'master' || !canUseEvolution}
              className="bg-primary hover:bg-primary/90"
            >
              {sendingTest ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Enviar
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
