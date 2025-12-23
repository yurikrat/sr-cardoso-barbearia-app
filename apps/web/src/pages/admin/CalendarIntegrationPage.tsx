import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Copy, Check } from 'lucide-react';
import { BARBERS } from '@/utils/constants';

export default function CalendarIntegrationPage() {
  const { toast } = useToast();
  const [selectedBarber, setSelectedBarber] = useState<string>('sr-cardoso');
  const [calendarToken, setCalendarToken] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const loadBarberToken = useCallback(async () => {
    try {
      const barberRef = doc(db, 'barbers', selectedBarber);
      const barberDoc = await getDoc(barberRef);
      
      if (barberDoc.exists()) {
        const data = barberDoc.data();
        setCalendarToken(data.calendarFeedToken || '');
      }
    } catch (error: unknown) {
      console.error('Error loading barber:', error);
    }
  }, [selectedBarber]);

  useEffect(() => {
    loadBarberToken();
  }, [loadBarberToken]);

  const calendarUrl = calendarToken
    ? `${window.location.origin}/ical/barber/${selectedBarber}/${calendarToken}.ics`
    : '';

  const handleCopy = () => {
    if (calendarUrl) {
      navigator.clipboard.writeText(calendarUrl);
      setCopied(true);
      toast({
        title: 'Copiado!',
        description: 'URL do calendário copiada para a área de transferência.',
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h2 className="text-2xl font-serif font-bold mb-2">Integração de Calendário</h2>
          <p className="text-muted-foreground">
            Adicione sua agenda ao seu calendário pessoal (iPhone, Android, Google Calendar)
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Escolha o barbeiro</CardTitle>
            <CardDescription>
              Selecione qual agenda você deseja adicionar ao seu calendário
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              {BARBERS.map((barber) => (
                <Button
                  key={barber.id}
                  variant={selectedBarber === barber.id ? 'default' : 'outline'}
                  onClick={() => setSelectedBarber(barber.id)}
                >
                  {barber.name}
                </Button>
              ))}
            </div>

            {calendarUrl && (
              <div className="space-y-4 pt-4 border-t">
                <div>
                  <label className="text-sm font-medium mb-2 block">URL do Calendário</label>
                  <div className="flex gap-2">
                    <Input
                      value={calendarUrl}
                      readOnly
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold mb-2">iPhone (iOS)</h4>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                      <li>Abra Configurações</li>
                      <li>Toque em Calendários</li>
                      <li>Toque em Adicionar Conta</li>
                      <li>Toque em Adicionar Conta de Calendário</li>
                      <li>Em Servidor, cole a URL acima</li>
                      <li>Toque em Avançar e depois em Salvar</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Android (Google Calendar)</h4>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                      <li>Abra o app Google Calendar</li>
                      <li>Toque no menu (três linhas)</li>
                      <li>Toque em Configurações</li>
                      <li>Toque em Adicionar conta</li>
                      <li>Toque em Outro</li>
                      <li>Cole a URL acima e toque em Adicionar</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Google Calendar (Web)</h4>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                      <li>Acesse calendar.google.com</li>
                      <li>No lado esquerdo, ao lado de "Outros calendários", clique no +</li>
                      <li>Clique em "De URL"</li>
                      <li>Cole a URL acima e clique em Adicionar calendário</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {!calendarToken && (
              <p className="text-sm text-muted-foreground">
                Token de calendário não encontrado. Entre em contato com o administrador.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

