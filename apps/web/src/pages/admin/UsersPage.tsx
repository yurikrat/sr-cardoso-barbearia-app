import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/LoadingSpinner';

type AdminUser = {
  id: string;
  username: string;
  role: 'master' | 'barber';
  barberId: string | null;
  active: boolean;
  lastLoginAt: string | null;
};

export default function UsersPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [newProfessionalName, setNewProfessionalName] = useState('');
  const [generatedCredentials, setGeneratedCredentials] = useState<null | { username: string; password: string }>(null);

  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);

  const barberNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of barbers) m.set(b.id, b.name);
    return m;
  }, [barbers]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [usersRes, barbersRes] = await Promise.all([api.admin.listAdminUsers(), api.admin.listBarbers()]);
      setUsers((usersRes.items ?? []) as AdminUser[]);
      setBarbers((barbersRes.items ?? []).map((b) => ({ id: b.id, name: b.name })));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({
        title: 'Erro',
        description: message || 'Não foi possível carregar usuários.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleCreateProfessionalAndLogin = async () => {
    setGeneratedCredentials(null);
    setLoading(true);
    try {
      const name = newProfessionalName.trim();
      if (!name) throw new Error('Nome do profissional é obrigatório');

      const result = await api.admin.createBarber({
        // id omitted -> server will generate from name and ensure uniqueness
        id: '',
        name,
        active: true,
        createLogin: true,
      });

      if (result.username && result.password) {
        setGeneratedCredentials({ username: result.username, password: result.password });
        try {
          await navigator.clipboard.writeText(`${result.username}:${result.password}`);
        } catch {
          // ignore
        }
      }

      toast({
        title: 'Sucesso',
        description: 'Profissional cadastrado e login criado. A senha foi exibida e copiada (se permitido).',
      });

      setNewProfessionalName('');
      await loadAll();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Erro ao cadastrar profissional.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (username: string, active: boolean) => {
    try {
      await api.admin.setAdminUserActive(username, active);
      await loadAll();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Erro ao atualizar usuário.', variant: 'destructive' });
    }
  };

  const handleResetPassword = async (username: string) => {
    const ok = confirm(`Resetar a senha do usuário "${username}"? Uma nova senha será gerada.`);
    if (!ok) return;
    try {
      const result = await api.admin.resetAdminUserPassword(username);
      if (result.password) {
        try {
          await navigator.clipboard.writeText(result.password);
        } catch {
          // ignore
        }
        toast({ title: 'Senha resetada', description: `Nova senha: ${result.password} (copiada se permitido)` });
      } else {
        toast({ title: 'Sucesso', description: 'Senha atualizada.' });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Erro ao resetar senha.', variant: 'destructive' });
    }
  };

  const handleDeleteUser = async (username: string) => {
    const ok = confirm(
      `Excluir o usuário "${username}"?\n\nIsso remove o login do painel. (O profissional na agenda pode continuar existindo.)`
    );
    if (!ok) return;
    try {
      await api.admin.deleteAdminUser(username);
      toast({ title: 'Sucesso', description: 'Usuário excluído.' });
      await loadAll();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Erro ao excluir usuário.', variant: 'destructive' });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold">Usuários</h2>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-serif">Cadastrar profissional (novo barbeiro)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pro-name">Nome do profissional</Label>
              <Input
                id="pro-name"
                value={newProfessionalName}
                onChange={(e) => setNewProfessionalName(e.target.value)}
                placeholder="ex: João Fernandes"
              />
            </div>
            <div className="space-y-2">
              <Label>ID do profissional (login)</Label>
              <div className="text-xs text-muted-foreground pt-2">
                O ID é gerado automaticamente a partir do nome (ex: "João Fernandes" → "joao-fernandes").
              </div>
            </div>
            <div className="sm:col-span-2 flex flex-col gap-2">
              <Button onClick={handleCreateProfessionalAndLogin} disabled={loading}>
                Cadastrar e gerar senha
              </Button>
              {generatedCredentials ? (
                <div className="text-sm rounded-md border p-3">
                  <div className="font-medium">Credenciais geradas</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Usuário: <span className="font-medium">{generatedCredentials.username}</span>
                    {' · '}Senha: <span className="font-medium">{generatedCredentials.password}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">(Copiada automaticamente, se o navegador permitir.)</div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-serif">Lista de usuários</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">Nenhum usuário.</div>
            ) : (
              users.map((u) => (
                <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-3">
                  <div>
                    <div className="font-medium">{u.username}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.role === 'master'
                        ? 'Master'
                        : `Barbeiro: ${u.barberId ? `${barberNameById.get(u.barberId) || '—'} (${u.barberId})` : '—'}`}
                      {u.lastLoginAt ? ` · Último login: ${new Date(u.lastLoginAt).toLocaleString('pt-BR')}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleResetPassword(u.username)}>
                      Resetar senha
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteUser(u.username)}>
                      Excluir
                    </Button>
                    <Button
                      variant={u.active ? 'destructive' : 'secondary'}
                      size="sm"
                      onClick={() => handleToggleActive(u.username, !u.active)}
                    >
                      {u.active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
