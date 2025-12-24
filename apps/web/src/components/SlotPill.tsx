import { cn } from '@/lib/utils';
import { DateTime } from 'luxon';
import { formatSlot } from '@/utils/slots';

interface SlotPillProps {
  slot: DateTime;
  status: 'available' | 'booked' | 'blocked' | 'past';
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function SlotPill({ slot, status, selected, onClick, disabled }: SlotPillProps) {
  const baseClasses =
    'px-4 py-3 rounded-lg text-sm font-medium transition-colors min-h-[44px] flex items-center justify-center border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  
  const statusClasses = {
    available: 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground cursor-pointer',
    booked: 'bg-muted text-muted-foreground border-muted cursor-not-allowed opacity-50',
    blocked: 'bg-destructive/20 text-destructive-foreground border-destructive/30 cursor-not-allowed opacity-50',
    past: 'bg-muted text-muted-foreground border-muted cursor-not-allowed opacity-30',
  };

  const selectedClasses = selected ? 'bg-primary text-primary-foreground border-primary hover:bg-primary hover:text-primary-foreground' : '';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || status !== 'available'}
      aria-pressed={selected}
      className={cn(baseClasses, statusClasses[status], selectedClasses, disabled && 'opacity-50 cursor-not-allowed')}
    >
      {formatSlot(slot)}
    </button>
  );
}

