import { Link } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  const { logoSrc } = useBranding();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-start p-4 safe-top-p4 safe-bottom-p4 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] md:bg-fixed overflow-x-hidden">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-4">
          <Link to="/" className="inline-block" aria-label="Ir para a página inicial">
            <img
              src={logoSrc}
              alt="Sr. Cardoso Barbearia"
              className="mx-auto w-56 h-auto drop-shadow-2xl"
            />
          </Link>
          <h1 className="sr-only">Sr. Cardoso Barbearia</h1>
          <div className="flex items-center justify-center gap-4">
            <div className="h-[1px] w-12 bg-primary/50"></div>
            <p className="text-primary font-serif italic tracking-[0.2em] uppercase text-xs">Tradição e Respeito</p>
            <div className="h-[1px] w-12 bg-primary/50"></div>
          </div>
        </div>

        <Card className="border-primary/20 bg-card/80 backdrop-blur-sm shadow-2xl">
          <CardHeader className="text-center border-b border-primary/10 pb-4">
            <CardTitle className="text-2xl font-serif text-foreground">Reserve seu Ritual</CardTitle>
            <CardDescription className="text-muted-foreground/80 italic">
              Personalize sua experiência
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-3 text-sm text-foreground/90 font-sans">
              <div className="flex items-center gap-3">
                <p>Atendimento: Segunda a Sábado, 08:00 às 19:00</p>
              </div>
              <div className="flex items-center gap-3">
                <p>Duração do ritual: 30 min</p>
              </div>
            </div>
            <Link to="/agendar" className="block">
              <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-serif text-lg h-14 shadow-lg transition-all hover:scale-[1.02]" size="lg">
                Reservar Horário
              </Button>
            </Link>
          </CardContent>
        </Card>

        <div className="space-y-1">
          <p className="text-center text-[10px] text-muted-foreground/50 uppercase tracking-widest font-sans">
            Desde 2019 • Barbearia Sr. Cardoso
          </p>

          <Link
            to="/admin/login"
            className="block text-center text-[10px] text-muted-foreground/50 hover:text-muted-foreground hover:underline"
            aria-label="Área Administrativa"
          >
            Área Administrativa
          </Link>
        </div>
      </div>
    </div>
  );
}

