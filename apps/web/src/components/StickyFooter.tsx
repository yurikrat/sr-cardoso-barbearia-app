import { ReactNode } from 'react';
import { useSafeArea } from '@/hooks/useSafeArea';

interface StickyFooterProps {
  children: ReactNode;
  className?: string;
}

export function StickyFooter({ children, className = '' }: StickyFooterProps) {
  const safeArea = useSafeArea();

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-background border-t p-4 safe-bottom ${className}`}
      style={{
        paddingBottom: `calc(1rem + ${safeArea.bottom}px)`,
      }}
    >
      {children}
    </div>
  );
}

