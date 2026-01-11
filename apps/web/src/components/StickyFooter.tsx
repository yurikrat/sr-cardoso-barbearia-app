import { ReactNode } from 'react';

interface StickyFooterProps {
  children: ReactNode;
  className?: string;
}

export function StickyFooter({ children, className = '' }: StickyFooterProps) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 bg-background border-t px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] ${className}`}
    >
      {children}
    </div>
  );
}

