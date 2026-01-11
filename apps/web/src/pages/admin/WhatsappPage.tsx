import { useEffect, useMemo, useState, useRef } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { api } from '@/lib/api';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, MessageSquare, Bell, Save, Send, Users, Image, Cake, Upload, X } from 'lucide-react';

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

  // Estados para notificações automáticas
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState({
    confirmationEnabled: true,
    confirmationMessage: 'Seu agendamento foi confirmado! Esperamos você na barbearia.',
    reminderEnabled: true,
    reminderMinutesBefore: 60,
    reminderMessage: 'Lembrete: seu horário na barbearia é daqui a pouco. Não se atrase!',
    cancellationMessage: 'Seu agendamento foi cancelado conforme solicitado. Esperamos você em breve!',
    birthdayEnabled: true,
    birthdayMessage: 'Feliz aniversário! 🎂🎉 A Barbearia Sr. Cardoso deseja a você um dia incrível cheio de alegrias. Como presente, que tal passar aqui pra ficar ainda mais bonito? Te esperamos!',
  });

  // Estados para disparo em massa (texto)
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    sent: number;
    failed: number;
    total: number;
  } | null>(null);

  // Estados para disparo em massa COM IMAGEM (upload)
  const [broadcastImageFile, setBroadcastImageFile] = useState<File | null>(null);
  const [broadcastImagePreview, setBroadcastImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qrSrc = useMemo(() => asDataUrl(qrBase64), [qrBase64]);
  const canUseEvolution = !!status && status.configured !== false;

  const statusSummary = useMemo(() => {
    if (!status) return { label: 'Desconhecido', description: 'Status não disponível', variant: 'secondary' as const, icon: AlertCircle };
    if (status.configured === false) return { label: 'Não configurado', description: 'Configuração pendente no servidor', variant: 'destructive' as const, icon: XCircle };
    if (!status.instanceExists) return { label: 'Instância não encontrada', description: 'Crie ou conecte uma instância', variant: 'secondary' as const, icon: AlertCircle };

    const raw = status.connectionState?.trim() || '';
    const s = raw.toLowerCase();
    if (!s) return { label: 'Sem estado', description: 'Aguardando informações', variant: 'secondary' as const, icon: AlertCircle };
    if (s === 'open' || s === 'connected') return { label: 'Conectado', description: 'WhatsApp pronto para enviar mensagens!', variant: 'default' as const, icon: CheckCircle };
    if (s === 'connecting') return { label: 'Conectando...', description: 'Aguarde ou escaneie o QR Code', variant: 'secondary' as const, icon: AlertCircle };
    if (s === 'close' || s === 'closed' || s === 'disconnected') return { label: 'Desconectado', description: 'Conecte para usar o WhatsApp', variant: 'destructive' as const, icon: XCircle };
    return { label: raw, description: 'Status técnico recebido', variant: 'secondary' as const, icon: AlertCircle };
  }, [status]);

  const loadStatus = async () => {
    const data = await api.admin.whatsappStatus();
    setStatus(data);
  };

  const loadNotificationSettings = async () => {
    setLoadingNotifications(true);
    try {
      const data = await api.admin.whatsappGetNotificationSettings();
      setNotificationSettings(data);
    } catch (e: any) {
      // Se não existir configuração ainda, usa os defaults
      console.log('Using default notification settings');
    } finally {
      setLoadingNotifications(false);
    }
  };

  const saveNotificationSettings = async () => {
    setSavingNotifications(true);
    try {
      await api.admin.whatsappSaveNotificationSettings(notificationSettings);
      toast({ title: 'Salvo', description: 'Configurações de notificações salvas.' });
    } catch (e: any) {
      toast({
        title: 'Erro ao salvar',
        description: e?.message || 'Não foi possível salvar as configurações.',
        variant: 'destructive',
      });
    } finally {
      setSavingNotifications(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadStatus();
        if (claims?.role === 'master') {
          await loadNotificationSettings();
        }
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
  }, [toast, claims?.role]);

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
    setDisconnecting(true);
    try {
      await api.admin.whatsappDisconnect();
      setQrBase64(null);
      setPairingCode(null);
      await loadStatus();
      toast({ title: 'Desconectado', description: 'Sessão do WhatsApp removida. Conecte novamente para usar.' });
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

  const onSendBroadcast = async () => {
    // Se tem imagem mas não tem mensagem, permitir (a legenda pode ser opcional)
    // Se não tem imagem, precisa de mensagem
    if (!broadcastImageFile && (!broadcastMessage.trim() || broadcastMessage.trim().length < 5)) {
      toast({
        title: 'Mensagem muito curta',
        description: 'A mensagem deve ter pelo menos 5 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    // Confirmação antes de enviar
    const hasImage = !!broadcastImageFile;
    const confirmText = hasImage
      ? `Tem certeza que deseja enviar esta IMAGEM${broadcastMessage.trim() ? ' com mensagem' : ''} para TODOS os clientes cadastrados?`
      : `Tem certeza que deseja enviar esta mensagem para TODOS os clientes cadastrados?`;
    if (!window.confirm(confirmText)) return;

    setSendingBroadcast(true);
    setBroadcastResult(null);
    try {
      let result;
      
      if (broadcastImageFile) {
        // Converter imagem para base64
        const base64 = await fileToBase64(broadcastImageFile);
        result = await api.admin.whatsappBroadcastMedia(base64, broadcastMessage.trim());
      } else {
        result = await api.admin.whatsappBroadcast(broadcastMessage.trim());
      }

      setBroadcastResult({
        sent: result.sent,
        failed: result.failed,
        total: result.total,
      });
      toast({
        title: 'Disparo concluído',
        description: `Enviado: ${result.sent} | Falhou: ${result.failed} | Total: ${result.total}`,
      });
      if (result.sent > 0) {
        setBroadcastMessage('');
        setBroadcastImageFile(null);
        setBroadcastImagePreview(null);
      }
    } catch (e: any) {
      toast({
        title: 'Erro no disparo',
        description: e?.message || 'Não foi possível enviar as mensagens.',
        variant: 'destructive',
      });
    } finally {
      setSendingBroadcast(false);
    }
  };

  // Função auxiliar para converter File para base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result); // Já vem como data:image/...;base64,...
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handler para upload de imagem
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar tipo
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Arquivo inválido',
        description: 'Selecione uma imagem (JPG, PNG, etc.)',
        variant: 'destructive',
      });
      return;
    }

    // Validar tamanho (máximo 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'A imagem deve ter no máximo 5MB.',
        variant: 'destructive',
      });
      return;
    }

    setBroadcastImageFile(file);
    
    // Criar preview
    const reader = new FileReader();
    reader.onload = () => {
      setBroadcastImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setBroadcastImageFile(null);
    setBroadcastImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
            <p className="text-muted-foreground">Conexão e testes via Evolution.</p>
          </div>
          <Button onClick={onRefresh} disabled={refreshing} className="w-auto bg-primary hover:bg-primary/90">
            {refreshing ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
            Atualizar
          </Button>
        </div>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Status da Conexão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const IconComponent = statusSummary.icon;
              const iconColor = statusSummary.variant === 'default' ? 'text-green-500' : statusSummary.variant === 'destructive' ? 'text-red-500' : 'text-yellow-500';
              return (
                <div className="flex items-center gap-3">
                  <IconComponent className={`h-8 w-8 ${iconColor}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={statusSummary.variant}>{statusSummary.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{statusSummary.description}</p>
                  </div>
                </div>
              );
            })()}

            {status?.hint ? <p className="text-xs text-muted-foreground border-l-2 border-primary/20 pl-3">{status.hint}</p> : null}
            
            {status?.configured === false ? (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
                ⚠️ Configuração incompleta no servidor: {(status.missing || []).join(', ') || 'EVOLUTION_*'}
              </div>
            ) : null}

            {claims?.role === 'master' && statusSummary.label === 'Conectado' ? (
              <div className="pt-2 border-t border-primary/10">
                <Button
                  onClick={onDisconnect}
                  disabled={disconnecting || !canUseEvolution}
                  variant="outline"
                  className="w-auto"
                >
                  {disconnecting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Desconectar sessão
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Conectar</CardTitle>
            <CardDescription>Gera um QR Code ou código para parear o WhatsApp.</CardDescription>
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
              className="w-auto bg-primary hover:bg-primary/90"
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
              className="w-auto bg-primary hover:bg-primary/90"
            >
              {sendingTest ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Enviar
            </Button>
          </CardContent>
        </Card>
        </div>

        {/* Seção de Notificações Automáticas - só para master */}
        {claims?.role === 'master' && (
          <>
            <Separator className="my-8" />
            
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-serif font-bold text-foreground flex items-center gap-2">
                  <Bell className="h-6 w-6" />
                  Notificações Automáticas
                </h3>
                <p className="text-muted-foreground">Configure mensagens automáticas para seus clientes.</p>
              </div>
              <Button 
                onClick={saveNotificationSettings} 
                disabled={savingNotifications || loadingNotifications}
                className="w-auto"
              >
                {savingNotifications ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar Configurações
              </Button>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Confirmação de Agendamento */}
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      <CardTitle>Confirmação de Agendamento</CardTitle>
                    </div>
                    <Switch
                      checked={notificationSettings.confirmationEnabled}
                      onCheckedChange={(checked: boolean) =>
                        setNotificationSettings({ ...notificationSettings, confirmationEnabled: checked })
                      }
                    />
                  </div>
                  <CardDescription>
                    Mensagem enviada automaticamente quando o cliente faz um agendamento.
                    O link para cancelar/reagendar é incluído automaticamente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="confirmationMessage">Mensagem de confirmação</Label>
                    <textarea
                      id="confirmationMessage"
                      value={notificationSettings.confirmationMessage}
                      onChange={(e) =>
                        setNotificationSettings({ ...notificationSettings, confirmationMessage: e.target.value })
                      }
                      placeholder="Tudo certo! Seu horário está reservado. Chega uns 5 minutinhos antes pra gente te atender com calma."
                      className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      disabled={!notificationSettings.confirmationEnabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      O nome do cliente, data, hora, serviço e link de cancelamento serão adicionados automaticamente.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Lembrete */}
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5 text-primary" />
                      <CardTitle>Lembrete de Atendimento</CardTitle>
                    </div>
                    <Switch
                      checked={notificationSettings.reminderEnabled}
                      onCheckedChange={(checked: boolean) =>
                        setNotificationSettings({ ...notificationSettings, reminderEnabled: checked })
                      }
                    />
                  </div>
                  <CardDescription>
                    Mensagem enviada antes do horário do atendimento para lembrar o cliente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reminderMinutes">Enviar lembrete quantos minutos antes?</Label>
                    <Select
                      value={String(notificationSettings.reminderMinutesBefore)}
                      onValueChange={(v) =>
                        setNotificationSettings({ ...notificationSettings, reminderMinutesBefore: Number(v) })
                      }
                      disabled={!notificationSettings.reminderEnabled}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutos</SelectItem>
                        <SelectItem value="30">30 minutos</SelectItem>
                        <SelectItem value="60">1 hora</SelectItem>
                        <SelectItem value="120">2 horas</SelectItem>
                        <SelectItem value="180">3 horas</SelectItem>
                        <SelectItem value="1440">1 dia (24 horas)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reminderMessage">Mensagem de lembrete</Label>
                    <textarea
                      id="reminderMessage"
                      value={notificationSettings.reminderMessage}
                      onChange={(e) =>
                        setNotificationSettings({ ...notificationSettings, reminderMessage: e.target.value })
                      }
                      placeholder="Falta pouco pro seu horário! Te vejo daqui a pouco aqui na barbearia."
                      className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      disabled={!notificationSettings.reminderEnabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      O nome do cliente, hora e serviço serão adicionados automaticamente.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Cancelamento */}
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-primary" />
                    <CardTitle>Confirmação de Cancelamento</CardTitle>
                  </div>
                  <CardDescription>
                    Mensagem enviada quando o cliente cancela um agendamento.
                    O link para fazer novo agendamento é incluído automaticamente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cancellationMessage">Mensagem de cancelamento</Label>
                    <textarea
                      id="cancellationMessage"
                      value={notificationSettings.cancellationMessage}
                      onChange={(e) =>
                        setNotificationSettings({ ...notificationSettings, cancellationMessage: e.target.value })
                      }
                      placeholder="Cancelado! Quando quiser reagendar, é só clicar no link abaixo. Vai ser um prazer te atender."
                      className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      O nome do cliente e link para novo agendamento serão adicionados automaticamente.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Mensagem de Aniversário */}
              <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cake className="h-5 w-5 text-primary" />
                      <CardTitle>Feliz Aniversário</CardTitle>
                    </div>
                    <Switch
                      checked={notificationSettings.birthdayEnabled}
                      onCheckedChange={(checked: boolean) =>
                        setNotificationSettings({ ...notificationSettings, birthdayEnabled: checked })
                      }
                    />
                  </div>
                  <CardDescription>
                    Mensagem enviada automaticamente no dia do aniversário de cada cliente.
                    Enviada uma vez por ano para quem tem data de nascimento cadastrada.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="birthdayMessage">Mensagem de aniversário</Label>
                    <textarea
                      id="birthdayMessage"
                      value={notificationSettings.birthdayMessage}
                      onChange={(e) =>
                        setNotificationSettings({ ...notificationSettings, birthdayMessage: e.target.value })
                      }
                      placeholder="Feliz aniversário! 🎂🎉 A Barbearia Sr. Cardoso deseja a você um dia incrível..."
                      className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      disabled={!notificationSettings.birthdayEnabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      O nome do cliente e link para agendamento serão adicionados automaticamente.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Seção de Disparo em Massa */}
            <Separator className="my-8" />
            
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-serif font-bold text-foreground flex items-center gap-2">
                  <Users className="h-6 w-6" />
                  Disparo em Massa
                </h3>
                <p className="text-muted-foreground">Envie mensagens para todos os clientes cadastrados.</p>
              </div>
            </div>

            <Card className="border-primary/10 bg-card/50 backdrop-blur-sm max-w-2xl">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-primary" />
                  <CardTitle>Nova Mensagem</CardTitle>
                </div>
                <CardDescription>
                  Envie uma mensagem de texto ou imagem para todos os clientes.
                  O nome de cada cliente será inserido automaticamente onde houver {'{nome}'}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Upload de Imagem (opcional) */}
                <div className="space-y-2">
                  <Label>Imagem (opcional)</Label>
                  
                  {broadcastImagePreview ? (
                    <div className="relative inline-block">
                      <img 
                        src={broadcastImagePreview} 
                        alt="Preview" 
                        className="max-h-48 rounded-lg border border-border object-contain"
                      />
                      <button
                        onClick={removeImage}
                        className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-md hover:bg-destructive/90 transition-colors"
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors active:scale-[0.98]"
                    >
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Clique ou arraste para enviar uma imagem
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPG, PNG até 5MB
                      </p>
                    </div>
                  )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={sendingBroadcast || !canUseEvolution || statusSummary.label !== 'Conectado'}
                  />
                </div>

                {/* Mensagem de Texto */}
                <div className="space-y-2">
                  <Label htmlFor="broadcastMessage">
                    {broadcastImageFile ? 'Legenda (opcional)' : 'Mensagem'}
                  </Label>
                  <textarea
                    id="broadcastMessage"
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="Olá {nome}! Temos novidades na barbearia..."
                    className="w-full min-h-[120px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    maxLength={1000}
                    disabled={sendingBroadcast || !canUseEvolution || statusSummary.label !== 'Conectado'}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Use {'{nome}'} para inserir o nome do cliente</span>
                    <span>{broadcastMessage.length}/1000</span>
                  </div>
                </div>

                {broadcastResult && (
                  <div className="p-3 rounded-md bg-muted/50 text-sm">
                    <div className="font-medium mb-1">Resultado:</div>
                    <div className="flex gap-4 flex-wrap">
                      <span className="text-green-600">✓ {broadcastResult.sent}</span>
                      <span className="text-red-600">✗ {broadcastResult.failed}</span>
                      <span className="text-muted-foreground">Total: {broadcastResult.total}</span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={onSendBroadcast}
                  disabled={
                    sendingBroadcast || 
                    (!broadcastImageFile && (!broadcastMessage.trim() || broadcastMessage.trim().length < 5)) || 
                    !canUseEvolution || 
                    statusSummary.label !== 'Conectado'
                  }
                  className="w-full bg-primary hover:bg-primary/90"
                >
                  {sendingBroadcast ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : broadcastImageFile ? (
                    <Image className="h-4 w-4 mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {sendingBroadcast 
                    ? 'Enviando...' 
                    : broadcastImageFile 
                      ? 'Enviar Imagem para Todos' 
                      : 'Enviar para Todos'}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
