import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface BarberCardProps {
  id: string;
  name: string;
  selected: boolean;
  onClick: () => void;
}

export function BarberCard({ name, selected, onClick }: BarberCardProps) {
  return (
    <Card
      className={cn(
        'p-6 cursor-pointer transition-colors min-h-[88px] flex flex-col items-center justify-center gap-2',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-accent hover:text-accent-foreground'
      )}
      onClick={onClick}
    >
      <span className="text-lg font-medium">{name}</span>
      <Badge variant="outline" className="text-xs">
        Agenda independente
      </Badge>
    </Card>
  );
}

