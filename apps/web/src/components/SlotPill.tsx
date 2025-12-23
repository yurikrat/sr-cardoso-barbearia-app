import { cn } from '@/lib/utils';
import { DateTime } from 'luxon';
import { formatSlot } from '@/utils/slots';

interface SlotPillProps {
  slot: DateTime;
  status: 'available' | 'booked' | 'blocked' | 'past';
  onClick?: () => void;
  disabled?: boolean;
}

export function SlotPill({ slot, status, onClick, disabled }: SlotPillProps) {
  const baseClasses = 'px-4 py-3 rounded-lg text-sm font-medium transition-colors min-h-[44px] flex items-center justify-center';
  
  const statusClasses = {
    available: 'bg-accent text-accent-foreground hover:bg-accent/80 cursor-pointer',
    booked: 'bg-muted text-muted-foreground cursor-not-allowed opacity-50',
    blocked: 'bg-destructive/20 text-destructive-foreground cursor-not-allowed opacity-50',
    past: 'bg-muted text-muted-foreground cursor-not-allowed opacity-30',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || status !== 'available'}
      className={cn(baseClasses, statusClasses[status], disabled && 'opacity-50 cursor-not-allowed')}
    >
      {formatSlot(slot)}
    </button>
  );
}

