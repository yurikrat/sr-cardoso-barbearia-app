import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Image as ImageIcon, Upload, Trash2, RefreshCw } from 'lucide-react';
import type { BrandingSettings } from '@sr-cardoso/shared';
import { useBranding } from '@/hooks/useBranding';
import { useAdminAutoRefreshToken } from '@/contexts/AdminAutoRefreshContext';

export default function BrandingPage() {
  const { toast } = useToast();
  const { refreshBranding } = useBranding();
  const refreshToken = useAdminAutoRefreshToken();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [hasPendingLogoChange, setHasPendingLogoChange] = useState(false);
  
  const [settings, setSettings] = useState<BrandingSettings | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.admin.getBranding();
        setSettings(data);
      } catch {
        toast({
          title: 'Erro ao carregar branding',
          description: 'Não foi possível carregar as configurações de marca.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [toast, refreshToken]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await api.admin.updateBranding({ ...settings, commitLogo: hasPendingLogoChange });
      
      setHasPendingLogoChange(false);
      await refreshBranding();
      toast({
        title: 'Configurações salvas',
        description: 'A identidade visual foi atualizada com sucesso.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast({
        title: 'Erro ao salvar',
        description: message || 'Ocorreu um erro ao salvar as configurações.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);

    try {
      const { url } = await api.admin.uploadBrandingAsset(file, 'logo');
      
      setSettings((prev: BrandingSettings | null) =>
        prev
          ? {
              ...prev,
              logoUrl: url,
            }
          : null
      );
      setHasPendingLogoChange(true);
      
      toast({
        title: 'Preview atualizado',
        description: 'Clique em Salvar para aplicar as alterações.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast({
        title: 'Erro no upload',
        description: message || 'Não foi possível enviar a imagem.',
        variant: 'destructive',
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  if (loading || !settings) {
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
            <h2 className="text-3xl font-serif font-bold text-foreground">Identidade Visual</h2>
            <p className="text-muted-foreground">Gerencie o logo da barbearia.</p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-auto bg-primary hover:bg-primary/90">
            {saving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salvar Alterações
          </Button>
        </div>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" />
              Logo Principal
            </CardTitle>
            <CardDescription>
              Aparece no topo do admin e na página inicial do cliente. 
              O logo será redimensionado automaticamente para h-10 (40px).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-primary/20 rounded-lg bg-background/50 relative group">
              {settings.logoUrl ? (
                <div className="relative">
                  <img 
                    src={settings.logoUrl} 
                    alt="Preview Logo" 
                    className="max-h-32 w-auto object-contain"
                  />
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="absolute -top-2 -right-2 h-10 w-10 opacity-0 group-hover:opacity-100 sm:transition-opacity touch:opacity-100"
                    onClick={() => setSettings({ ...settings, logoUrl: null })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="text-center">
                  <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum logo configurado</p>
                </div>
              )}
              
              <div className="mt-4">
                <Label htmlFor="logo-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors">
                    {uploadingLogo ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{settings.logoUrl ? 'Alterar Logo' : 'Fazer Upload'}</span>
                  </div>
                  <input 
                    id="logo-upload" 
                    type="file" 
                    className="hidden" 
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={uploadingLogo}
                  />
                </Label>
              </div>
            </div>

            <div className="p-4 bg-primary/5 rounded-md border border-primary/10">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong>Dica:</strong> Use uma imagem PNG com fundo transparente para melhores resultados. 
                O logo será otimizado automaticamente (máximo 1200px de largura).
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
