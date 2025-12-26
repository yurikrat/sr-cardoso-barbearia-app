import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface BarberCardProps {
  id: string;
  name: string;
  image?: string;
  selected: boolean;
  onClick: () => void;
}

export function BarberCard({ name, image, selected, onClick }: BarberCardProps) {
  return (
    <Card
      className={cn(
        'p-4 cursor-pointer transition-all duration-200 flex items-center gap-4',
        selected
          ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2'
          : 'hover:bg-accent hover:text-accent-foreground bg-card'
      )}
      onClick={onClick}
    >
      <div className={cn(
        "relative w-24 h-24 rounded-full overflow-hidden border-2 shrink-0",
        selected ? "border-primary-foreground/20" : "border-muted"
      )}>
        {image ? (
          <img 
            src={image} 
            alt={name} 
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground font-bold text-2xl">
            {name.charAt(0)}
          </div>
        )}
      </div>
      
      <div className="flex flex-col items-start gap-1">
        <span className="text-lg font-medium leading-none">{name}</span>
        <Badge 
          variant={selected ? "secondary" : "outline"} 
          className={cn("text-xs font-normal", selected && "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 border-transparent")}
        >
          Profissional
        </Badge>
      </div>
    </Card>
  );
}

