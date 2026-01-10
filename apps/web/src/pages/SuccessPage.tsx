import { Link } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';
import { Button } from '@/components/ui/button';
import { useBookingState } from '@/contexts/BookingContext';

export default function SuccessPage() {
  const { logoSrc } = useBranding();
  const bookingState = useBookingState();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 safe-top-p4 safe-bottom-p4 overflow-x-hidden">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <Link to="/" className="inline-block" aria-label="Ir para a página inicial">
            <img 
              src={logoSrc} 
              alt="Sr. Cardoso Barbearia" 
              className="mx-auto w-40 h-auto"
            />
          </Link>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Seu Ritual está agendado.
          </h1>
          <p className="text-muted-foreground italic">
            "A excelência não é um ato, mas um hábito."
          </p>
        </div>

        <div className="w-full">
          <Link
            to="/"
            className="block"
            onClick={() => bookingState.clearBooking()}
          >
            <Button className="w-full" variant="secondary">
              Voltar ao início
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
