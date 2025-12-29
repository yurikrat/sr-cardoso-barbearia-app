import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';

export default function ChangePasswordPage() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: 'Erro', description: 'A nova senha deve ter pelo menos 6 caracteres.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await api.admin.changeMyPassword(currentPassword, newPassword);
      toast({ title: 'Sucesso', description: 'Sua senha foi alterada com sucesso.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Não foi possível alterar a senha.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-serif font-bold tracking-tight">Segurança</h2>
          <p className="text-muted-foreground">Gerencie o acesso à sua conta administrativa.</p>
        </div>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm shadow-xl overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary/40" />
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>
              <CardTitle className="text-xl font-serif">Alterar Senha</CardTitle>
            </div>
            <CardDescription>
              Recomendamos o uso de uma senha forte e única para sua segurança.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cur" className="text-sm font-medium">Senha atual</Label>
                  <Input
                    id="cur"
                    type="password"
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="bg-background/50 border-primary/10 focus:border-primary/30 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="next" className="text-sm font-medium">Nova senha</Label>
                  <Input
                    id="next"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className="bg-background/50 border-primary/10 focus:border-primary/30 transition-all"
                  />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mínimo de 6 caracteres</p>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary/60" />
                  <span>Sua senha é criptografada de ponta a ponta.</span>
                </div>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="min-w-[120px] shadow-lg shadow-primary/20"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando
                    </>
                  ) : (
                    'Atualizar Senha'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
