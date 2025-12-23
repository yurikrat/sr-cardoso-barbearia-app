import { useOffline } from '@/hooks/useOffline';
import { AlertCircle } from 'lucide-react';

export function OfflineIndicator() {
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-destructive text-destructive-foreground p-2 text-center text-sm safe-top z-50">
      <div className="flex items-center justify-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <span>Você está offline. Verifique sua conexão.</span>
      </div>
    </div>
  );
}

