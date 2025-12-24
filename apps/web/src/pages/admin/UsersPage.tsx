import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'barber' | 'master'>('barber');
  const [newBarberId, setNewBarberId] = useState('');

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

  const handleCreate = async () => {
    try {
      if (!newUsername.trim()) throw new Error('Usuário é obrigatório');
      if (!newPassword) throw new Error('Senha é obrigatória');
      if (newRole === 'barber' && !newBarberId) throw new Error('Selecione o barbeiro');

      await api.admin.createAdminUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
        barberId: newRole === 'barber' ? newBarberId : null,
        active: true,
      });

      toast({ title: 'Sucesso', description: 'Usuário criado.' });
      setNewUsername('');
      setNewPassword('');
      setNewBarberId('');
      await loadAll();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Erro ao criar usuário.', variant: 'destructive' });
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
    const next = prompt(`Nova senha para ${username}:`);
    if (!next) return;
    try {
      await api.admin.resetAdminUserPassword(username, next);
      toast({ title: 'Sucesso', description: 'Senha atualizada.' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast({ title: 'Erro', description: message || 'Erro ao resetar senha.', variant: 'destructive' });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold">Usuários</h2>

        <Card className="border-primary/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-serif">Criar usuário</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="u">Usuário</Label>
              <Input id="u" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="emanuel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p">Senha</Label>
              <Input id="p" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="barber">Barbeiro</SelectItem>
                  <SelectItem value="master">Master</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Barbeiro</Label>
              <Select value={newBarberId} onValueChange={setNewBarberId}>
                <SelectTrigger disabled={newRole !== 'barber'}>
                  <SelectValue placeholder={newRole === 'barber' ? 'Selecione' : '—'} />
                </SelectTrigger>
                <SelectContent>
                  {barbers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button onClick={handleCreate} disabled={loading}>
                Criar
              </Button>
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
                        : `Barbeiro: ${u.barberId ? barberNameById.get(u.barberId) || u.barberId : '—'}`}
                      {u.lastLoginAt ? ` · Último login: ${new Date(u.lastLoginAt).toLocaleString('pt-BR')}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleResetPassword(u.username)}>
                      Resetar senha
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
