import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (username.trim()) {
        await api.admin.loginWithUsername(username.trim(), password);
      } else {
        // Fallback for environments still using only ADMIN_PASSWORD.
        await api.admin.login(password);
      }
      navigate('/admin');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({
        title: 'Erro ao fazer login',
        description: message || 'Credenciais inválidas',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4 overflow-x-hidden">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link to="/" className="inline-block" aria-label="Ir para a página inicial">
            <img src="/logo.png" alt="Sr. Cardoso Barbearia" className="mx-auto w-40 h-auto" />
          </Link>
        </div>
        <Card>
        <CardHeader>
          <CardTitle>Login Admin</CardTitle>
          <CardDescription>Digite a senha do painel para acessar a agenda</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="username">Usuário</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex: sr-cardoso / emanuel"
                autoComplete="username"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Cada barbeiro entra com seu próprio usuário.
              </p>
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="mt-1"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
        </Card>
      </div>
    </div>
  );
}

