import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SERVICE_LABELS } from '@/utils/constants';

interface ServiceCardProps {
  serviceId: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}

export function ServiceCard({ serviceId, label, selected, onClick }: ServiceCardProps) {
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
      <span className="text-lg font-medium">{label || SERVICE_LABELS[serviceId] || serviceId}</span>
    </Card>
  );
}

