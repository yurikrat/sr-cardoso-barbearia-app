import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { api } from '@/lib/api';
import { RefreshCw, Link2, QrCode, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';

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
  const [disconnecting, setDisconnecting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

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

  const statusSummary = useMemo(() => {
    if (!status) return { label: 'Desconhecido', variant: 'secondary' as const, raw: null, isConnecting: false };
    if (status.configured === false) return { label: 'Não configurado', variant: 'destructive' as const, raw: null, isConnecting: false };
    if (!status.instanceExists) return { label: 'Sessão não encontrada', variant: 'destructive' as const, raw: status.connectionState, isConnecting: false };

    const raw = status.connectionState?.trim() || '';
    const s = raw.toLowerCase();
    if (!s) return { label: 'Sem estado', variant: 'secondary' as const, raw: null, isConnecting: false };
    if (s === 'open' || s === 'connected') return { label: 'Conectado', variant: 'default' as const, raw, isConnecting: false };
    if (s === 'connecting') return { label: 'Conectando...', variant: 'outline' as const, raw, isConnecting: true };
    if (s === 'close' || s === 'closed' || s === 'disconnected') return { label: 'Desconectado', variant: 'secondary' as const, raw, isConnecting: false };
    return { label: raw, variant: 'outline' as const, raw, isConnecting: false };
  }, [status]);

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

  // Auto-refresh when connecting
  useEffect(() => {
    if (!statusSummary.isConnecting) return;

    const interval = setInterval(async () => {
      try {
        await loadStatus();
      } catch {
        // Silent fail during auto-refresh
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [statusSummary.isConnecting]);

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

  const onDisconnect = async () => {
    setShowDisconnectDialog(false);
    setDisconnecting(true);
    try {
      await api.admin.whatsappDisconnect();
      setQrBase64(null);
      setPairingCode(null);
      await loadStatus();
      toast({ title: 'Desconectado', description: 'WhatsApp desconectado com sucesso.' });
    } catch (e: any) {
      toast({
        title: 'Erro ao desconectar',
        description: e?.message || 'Não foi possível desconectar o WhatsApp.',
        variant: 'destructive',
      });
    } finally {
      setDisconnecting(false);
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-serif font-bold text-foreground">WhatsApp</h2>
            <p className="text-muted-foreground">Gerenciar conexão e enviar mensagens.</p>
          </div>
          <Button onClick={onRefresh} disabled={refreshing} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 flex-none ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Status Summary Card */}
        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link2 className="h-6 w-6 flex-none text-primary" />
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Status da Conexão</div>
                  <Badge variant={statusSummary.variant} className="text-base px-3 py-1">
                    {statusSummary.label}
                  </Badge>
                </div>
              </div>
              {claims?.role === 'master' && statusSummary.label === 'Conectado' ? (
                <Button
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={disconnecting}
                  variant="outline"
                  size="sm"
                >
                  {disconnecting ? <RefreshCw className="h-4 w-4 mr-2 flex-none animate-spin" /> : null}
                  Desconectar
                </Button>
              ) : null}
            </div>

            {status?.hint ? (
              <div className="mt-4 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
                {status.hint}
              </div>
            ) : null}

            {status?.configured === false ? (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                Configuração incompleta no servidor: {(status.missing || []).join(', ') || 'EVOLUTION_*'}
              </div>
            ) : null}

            {/* Technical Details Toggle */}
            {claims?.role === 'master' ? (
              <>
                <Separator className="my-4" />
                <button
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    {showTechnicalDetails ? (
                    <ChevronUp className="h-4 w-4 flex-none" />
                  ) : (
                    <ChevronDown className="h-4 w-4 flex-none" />
                  )}
                  {showTechnicalDetails ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}
                </button>
                {showTechnicalDetails ? (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded">
                    <div><span className="font-semibold">Sessão:</span> {status?.instanceName || '-'}</div>
                    <div><span className="font-semibold">Existe:</span> {status?.instanceExists ? 'Sim' : 'Não'}</div>
                    <div><span className="font-semibold">Estado bruto:</span> {status?.connectionState || '-'}</div>
                    <div><span className="font-semibold">Fonte:</span> {status?.checkedBy || 'unknown'}</div>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Tabs for Connection and Test */}
        {claims?.role === 'master' ? (
          <Tabs defaultValue="connect" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="connect" className="flex items-center">
                <QrCode className="h-5 w-5 mr-2 flex-none" />
                Conectar
              </TabsTrigger>
              <TabsTrigger value="test" className="flex items-center">
                <MessageSquare className="h-5 w-5 mr-2 flex-none" />
                Testar Envio
              </TabsTrigger>
            </TabsList>

            <TabsContent value="connect">
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Conectar WhatsApp</CardTitle>
                  <CardDescription>
                    Escolha entre escanear um QR Code ou usar um código de pareamento.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Modo de Conexão</Label>
                    <Select value={connectMode} onValueChange={(v) => setConnectMode(v as any)}>
                      <SelectTrigger disabled={!canUseEvolution}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qr">Escanear QR Code</SelectItem>
                        <SelectItem value="pairingCode">Código de Pareamento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {connectMode === 'pairingCode' ? (
                    <div className="space-y-2">
                      <Label htmlFor="pairingPhone">Número do Celular</Label>
                      <Input
                        id="pairingPhone"
                        value={pairingPhone}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingPhone(e.target.value)}
                        placeholder="Ex: +5511999998888"
                        disabled={!canUseEvolution}
                      />
                      <div className="text-xs text-muted-foreground">
                        Digite o número completo com código do país (ex: +55 11 99999-8888).
                      </div>
                    </div>
                  ) : null}

                  <Button
                    onClick={onConnect}
                    disabled={
                      connecting ||
                      !canUseEvolution ||
                      (connectMode === 'pairingCode' && !pairingPhone.trim())
                    }
                    className="w-full bg-primary hover:bg-primary/90"
                  >
                    {connecting ? <RefreshCw className="h-4 w-4 mr-2 flex-none animate-spin" /> : null}
                    {connectMode === 'pairingCode' ? 'Gerar Código' : 'Gerar QR Code'}
                  </Button>

                  {pairingCode ? (
                    <div className="p-4 border-2 border-primary/30 rounded-lg bg-primary/5">
                      <div className="text-sm font-medium mb-2">Código de Pareamento Gerado</div>
                      <div className="font-mono text-2xl font-bold text-center tracking-wider text-primary">
                        {pairingCode}
                      </div>
                      <div className="text-xs text-muted-foreground mt-3">
                        Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho → Digite este código.
                      </div>
                    </div>
                  ) : null}

                  {qrSrc ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center p-6 border-2 border-primary/30 rounded-lg bg-white">
                        <img src={qrSrc} alt="QR Code WhatsApp" className="max-w-full h-auto" style={{ maxHeight: '280px' }} />
                      </div>
                      <div className="text-xs text-muted-foreground text-center">
                        Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho → Escaneie este QR Code.
                      </div>
                    </div>
                  ) : connectMode === 'qr' && !connecting ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      Clique em "Gerar QR Code" para começar.
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="test">
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Enviar Mensagem de Teste</CardTitle>
                  <CardDescription>
                    Teste a conexão enviando uma mensagem para qualquer número.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="toE164">Número do Celular</Label>
                    <Input
                      id="toE164"
                      value={toE164}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToE164(e.target.value)}
                      placeholder="Ex: +5511999998888"
                      disabled={!canUseEvolution}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="text">Mensagem</Label>
                    <Input
                      id="text"
                      value={text}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                      placeholder="Digite sua mensagem de teste aqui"
                      disabled={!canUseEvolution}
                    />
                  </div>
                  <Button
                    onClick={onSendTest}
                    disabled={sendingTest || !canUseEvolution}
                    className="w-full bg-primary hover:bg-primary/90"
                  >
                    {sendingTest ? (
                      <RefreshCw className="h-4 w-4 mr-2 shrink-0 aspect-square animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4 mr-2 shrink-0 aspect-square" />
                    )}
                    Enviar Mensagem
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
            <CardContent className="pt-6 text-center text-muted-foreground">
              Apenas usuários master podem gerenciar a conexão do WhatsApp.
            </CardContent>
          </Card>
        )}

        {/* Disconnect Confirmation Dialog */}
        <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Desconectar WhatsApp?</DialogTitle>
              <DialogDescription>
                Esta ação irá desconectar o WhatsApp da barbearia. Você precisará escanear o QR Code ou usar o código de pareamento novamente para reconectar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDisconnectDialog(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={onDisconnect}>
                Desconectar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
