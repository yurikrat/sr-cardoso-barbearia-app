import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, Calendar, Users, List, Wallet, UserCog } from 'lucide-react';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  type Role = 'master' | 'barber';

  const navItems: Array<{ path: string; label: string; icon: any; roles: Role[] }> = [
    { path: '/admin/agenda', label: 'Agenda', icon: Calendar, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/financeiro', label: 'Financeiro', icon: Wallet, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/clientes', label: 'Clientes', icon: Users, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/listas', label: 'Listas', icon: List, roles: ['master'] as Role[] },
    { path: '/admin/usuarios', label: 'Usuários', icon: UserCog, roles: ['master'] as Role[] },
  ].filter((i) => {
    if (!user) return false;
    return i.roles.includes(user.role);
  });

  return (
    <div className="min-h-[100dvh] bg-background bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] md:bg-fixed safe-top-p4 safe-bottom-p4 overflow-x-hidden">
      <header className="border-b border-primary/10 bg-card/50 backdrop-blur-md">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/logo.png" 
              alt="Logo" 
              className="h-10 w-auto drop-shadow-md"
            />
            <div className="hidden sm:block">
              <h1 className="text-xl font-serif font-bold text-foreground">Sr. Cardoso</h1>
              <p className="text-[10px] text-primary uppercase tracking-[0.3em] -mt-1">Painel Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-sans text-muted-foreground uppercase tracking-widest">
              {user ? (user.role === 'master' ? 'Administrador' : 'Barbeiro') : ''}
            </span>
            <Button variant="ghost" size="sm" onClick={logout} className="hover:bg-primary/10 hover:text-primary">
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <nav className="border-b border-primary/10 bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path}>
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    className={`flex items-center gap-2 transition-all ${isActive ? 'bg-primary text-primary-foreground' : 'hover:text-primary'}`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline font-serif">{item.label}</span>
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

