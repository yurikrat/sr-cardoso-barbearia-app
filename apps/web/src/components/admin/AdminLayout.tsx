import { ReactNode } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { BrandingLogo } from '@/components/BrandingLogo';
import { Button } from '@/components/ui/button';
import { LogOut, Calendar, Users, List, Wallet, UserCog, KeyRound, Clock, Palette, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AdminAutoRefreshProvider } from '@/contexts/AdminAutoRefreshContext';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  type Role = 'master' | 'barber';

  const navItems: Array<{ path: string; label: string; icon: LucideIcon; roles: Role[] }> = [
    { path: '/admin/agenda', label: 'Agenda', icon: Calendar, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/horarios', label: 'Horários', icon: Clock, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/financeiro', label: 'Financeiro', icon: Wallet, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/clientes', label: 'Clientes', icon: Users, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/senha', label: 'Senha', icon: KeyRound, roles: ['master', 'barber'] as Role[] },
    { path: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle, roles: ['master'] as Role[] },
    { path: '/admin/listas', label: 'Listas', icon: List, roles: ['master'] as Role[] },
    { path: '/admin/usuarios', label: 'Usuários', icon: UserCog, roles: ['master'] as Role[] },
    { path: '/admin/branding', label: 'Branding', icon: Palette, roles: ['master'] as Role[] },
  ].filter((i) => {
    if (!user) return false;
    return i.roles.includes(user.role);
  });

  const handleLogout = async () => {
    await logout();
    // Garante logout imediato (sem depender de re-render do SPA)
    window.location.replace('/admin/login');
  };

  return (
    <AdminAutoRefreshProvider pollIntervalMs={1000}>
      <div className="min-h-[100dvh] bg-background bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] md:bg-fixed safe-top-p4 safe-bottom-p4 overflow-x-hidden">
        <header className="border-b border-primary/10 bg-card/50 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto px-4 py-4">
            <div className="relative flex items-center justify-between min-h-[40px]">
              {/* Logo Section */}
              <div className="flex items-center gap-3">
                <Link to="/admin/agenda" className="flex items-center gap-3">
                  <BrandingLogo 
                    alt="Logo" 
                    className="h-10 w-auto drop-shadow-md"
                  />
                  <div className="hidden sm:block">
                    <h1 className="text-xl font-serif font-bold text-foreground">Sr. Cardoso</h1>
                    <p className="text-[10px] text-primary uppercase tracking-[0.3em] -mt-1">Painel Admin</p>
                  </div>
                </Link>
              </div>

              {/* Right Section (User Info) */}
              <div className="flex items-center gap-4 ml-auto">
                <span className="hidden xs:inline text-xs font-sans text-muted-foreground uppercase tracking-widest">
                  {user ? (user.role === 'master' ? 'Administrador' : 'Barbeiro') : ''}
                </span>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="hover:bg-primary/10 hover:text-primary">
                  <LogOut className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Sair</span>
                </Button>
              </div>
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
                      variant="ghost"
                      className={
                        `flex items-center gap-2 transition-colors ` +
                        (isActive
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                          : 'text-muted-foreground hover:bg-primary/10 hover:text-primary')
                      }
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
    </AdminAutoRefreshProvider>
  );
}

