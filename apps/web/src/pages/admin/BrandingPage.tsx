import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Image as ImageIcon, Upload, Trash2, AlignLeft, AlignCenter, AlignRight, RefreshCw } from 'lucide-react';
import type { BrandingSettings } from '@sr-cardoso/shared';
import { useBranding } from '@/hooks/useBranding';

export default function BrandingPage() {
  const { toast } = useToast();
  const { refreshBranding } = useBranding();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  
  const [settings, setSettings] = useState<BrandingSettings | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.admin.getBranding();
        setSettings(data);
      } catch (err) {
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
  }, [toast]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await api.admin.updateBranding(settings);
      await refreshBranding();
      toast({
        title: 'Configurações salvas',
        description: 'A identidade visual foi atualizada com sucesso.',
      });
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err.message || 'Ocorreu um erro ao salvar as configurações.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'favicon') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'logo') setUploadingLogo(true);
    else setUploadingFavicon(true);

    try {
      const { url } = await api.admin.uploadBrandingAsset(file, type);
      setSettings((prev: BrandingSettings | null) => prev ? ({
        ...prev,
        [type === 'logo' ? 'logoUrl' : 'faviconUrl']: url
      }) : null);
      
      toast({
        title: 'Upload concluído',
        description: `${type === 'logo' ? 'Logo' : 'Favicon'} enviado com sucesso.`,
      });
    } catch (err: any) {
      toast({
        title: 'Erro no upload',
        description: err.message || 'Não foi possível enviar a imagem.',
        variant: 'destructive',
      });
    } finally {
      if (type === 'logo') setUploadingLogo(false);
      else setUploadingFavicon(false);
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
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-serif font-bold text-foreground">Identidade Visual</h2>
            <p className="text-muted-foreground">Gerencie o logo, favicon e aparência da barbearia.</p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90">
            {saving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salvar Alterações
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Logo Section */}
          <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-primary" />
                Logo Principal
              </CardTitle>
              <CardDescription>Aparece no topo do admin e na página inicial do cliente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-primary/20 rounded-lg bg-background/50 relative group">
                {settings.logoUrl ? (
                  <div className="relative">
                    <img 
                      src={settings.logoUrl} 
                      alt="Preview Logo" 
                      className="max-h-32 w-auto object-contain transition-transform"
                      style={{ transform: `scale(${settings.logoScale})` }}
                    />
                    <Button 
                      variant="destructive" 
                      size="icon" 
                      className="absolute -top-2 -right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
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
                      onChange={(e) => handleFileUpload(e, 'logo')}
                      disabled={uploadingLogo}
                    />
                  </Label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Alinhamento do Logo</Label>
                  <div className="flex gap-2">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <Button
                        key={align}
                        variant={settings.logoAlignment === align ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1"
                        onClick={() => setSettings({ ...settings, logoAlignment: align })}
                      >
                        {align === 'left' && <AlignLeft className="h-4 w-4 mr-2" />}
                        {align === 'center' && <AlignCenter className="h-4 w-4 mr-2" />}
                        {align === 'right' && <AlignRight className="h-4 w-4 mr-2" />}
                        <span className="capitalize">{align === 'left' ? 'Esquerda' : align === 'center' ? 'Centro' : 'Direita'}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Escala do Logo</Label>
                    <span className="text-xs text-muted-foreground">{settings.logoScale.toFixed(1)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="2.0" 
                    step="0.1" 
                    value={settings.logoScale}
                    onChange={(e) => setSettings({ ...settings, logoScale: parseFloat(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Favicon Section */}
          <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-primary" />
                Favicon
              </CardTitle>
              <CardDescription>Ícone que aparece na aba do navegador (será redimensionado para 32x32).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-primary/20 rounded-lg bg-background/50 relative group">
                {settings.faviconUrl ? (
                  <div className="relative p-4 bg-white rounded shadow-inner">
                    <img 
                      src={settings.faviconUrl} 
                      alt="Preview Favicon" 
                      className="h-8 w-8 object-contain"
                    />
                    <Button 
                      variant="destructive" 
                      size="icon" 
                      className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setSettings({ ...settings, faviconUrl: null })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhum favicon configurado</p>
                  </div>
                )}
                
                <div className="mt-4">
                  <Label htmlFor="favicon-upload" className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors">
                      {uploadingFavicon ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      <span>{settings.faviconUrl ? 'Alterar Favicon' : 'Fazer Upload'}</span>
                    </div>
                    <input 
                      id="favicon-upload" 
                      type="file" 
                      className="hidden" 
                      accept="image/*"
                      onChange={(e) => handleFileUpload(e, 'favicon')}
                      disabled={uploadingFavicon}
                    />
                  </Label>
                </div>
              </div>

              <div className="p-4 bg-primary/5 rounded-md border border-primary/10">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>Dica:</strong> Use uma imagem quadrada com fundo transparente para melhores resultados. 
                  O sistema converterá automaticamente para o formato ideal.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
