import { cn } from '@/lib/utils';

interface StepperProps {
  currentStep: number;
  totalSteps: number;
}

export function Stepper({ currentStep, totalSteps }: StepperProps) {
  return (
    <div className="flex items-center w-full mb-6">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const step = index + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;

        return (
          <div key={step} className="flex items-center flex-1 min-w-0">
            <div
              className={cn(
                'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors shrink-0',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isCompleted
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {isCompleted ? '✓' : step}
            </div>
            {step < totalSteps && (
              <div className={cn('h-0.5 mx-1 flex-1', isCompleted ? 'bg-accent' : 'bg-muted')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

