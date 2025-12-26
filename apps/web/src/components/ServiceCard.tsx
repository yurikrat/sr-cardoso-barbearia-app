import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SERVICE_LABELS } from '@/utils/constants';

interface ServiceCardProps {
  serviceId: string;
  label: string;
  priceCents?: number;
  isMostPopular?: boolean;
  selected: boolean;
  onClick: () => void;
}

export function ServiceCard({ serviceId, label, priceCents, isMostPopular, selected, onClick }: ServiceCardProps) {
  const formatPrice = (cents: number) => {
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  return (
    <Card
      className={cn(
        'relative p-6 cursor-pointer transition-all duration-200 min-h-[100px] flex flex-col items-center justify-center gap-2 text-center',
        selected
          ? 'bg-primary text-primary-foreground shadow-lg scale-[1.02]'
          : 'hover:bg-accent hover:text-accent-foreground hover:border-primary/50'
      )}
      onClick={onClick}
    >
      {isMostPopular && (
        <Badge variant="secondary" className="absolute top-3 right-3 text-[11px]">
          Mais popular
        </Badge>
      )}
      <span className="text-lg font-bold leading-tight">
        {label || SERVICE_LABELS[serviceId] || serviceId}
      </span>
      {priceCents !== undefined && (
        <span className={cn(
          "text-sm font-medium",
          selected ? "text-primary-foreground/90" : "text-muted-foreground"
        )}>
          {formatPrice(priceCents)}
        </span>
      )}
    </Card>
  );
}

