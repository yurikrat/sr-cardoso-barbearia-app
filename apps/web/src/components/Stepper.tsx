import { cn } from '@/lib/utils';

interface StepperProps {
  currentStep: number;
  totalSteps: number;
  onStepClick?: (step: number) => void;
}

export function Stepper({ currentStep, totalSteps, onStepClick }: StepperProps) {
  return (
    <div className="flex items-center w-full mb-6">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const step = index + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        const isClickable = Boolean(onStepClick) && isCompleted;

        const handleActivate = (event: React.SyntheticEvent) => {
          if (!isClickable) return;
          event.preventDefault();
          event.stopPropagation();
          onStepClick?.(step);
        };

        return (
          <div key={step} className="flex items-center flex-1 min-w-0">
            <button
              type="button"
              onClick={handleActivate}
              onPointerUp={handleActivate}
              onTouchEnd={handleActivate}
              aria-label={isClickable ? `Voltar para o passo ${step}` : `Passo ${step}`}
              aria-disabled={!isClickable}
              className={cn(
                'shrink-0 p-2 -m-2 touch-manipulation rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isClickable ? 'cursor-pointer' : 'cursor-default'
              )}
            >
              <span
                className={cn(
                  'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isCompleted
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted ? '✓' : step}
              </span>
            </button>
            {step < totalSteps && (
              <div className={cn('h-0.5 mx-1 flex-1', isCompleted ? 'bg-accent' : 'bg-muted')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

