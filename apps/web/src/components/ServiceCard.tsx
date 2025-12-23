import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ServiceType } from '@sr-cardoso/shared';

interface ServiceCardProps {
  service: ServiceType;
  label: string;
  selected: boolean;
  onClick: () => void;
}

const serviceLabels: Record<ServiceType, string> = {
  cabelo: 'Cabelo',
  barba: 'Barba',
  cabelo_barba: 'Cabelo + Barba',
};

export function ServiceCard({ service, label, selected, onClick }: ServiceCardProps) {
  return (
    <Card
      className={cn(
        'p-6 cursor-pointer transition-colors min-h-[88px] flex items-center justify-center',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-accent hover:text-accent-foreground'
      )}
      onClick={onClick}
    >
      <span className="text-lg font-medium">{label || serviceLabels[service]}</span>
    </Card>
  );
}

