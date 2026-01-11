import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

/**
 * Minimal tooltip built on Radix Popover (already in deps).
 * Opens on hover/focus; closes on mouse leave/blur.
 */

type TooltipContextValue = {
  open: boolean;
  setOpen: (value: boolean) => void;
};

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        {children}
      </PopoverPrimitive.Root>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const ctx = React.useContext(TooltipContext);
  if (!ctx) throw new Error('TooltipTrigger must be used within <Tooltip>.');

  const handleOpen = () => ctx.setOpen(true);
  const handleClose = () => ctx.setOpen(false);

  return (
    <PopoverPrimitive.Trigger
      asChild={asChild}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocus={handleOpen}
      onBlur={handleClose}
    >
      {children as any}
    </PopoverPrimitive.Trigger>
  );
}

export function TooltipContent({
  children,
  className,
  sideOffset = 6,
  align = 'center',
}: {
  children: React.ReactNode;
  className?: string;
  sideOffset?: number;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
