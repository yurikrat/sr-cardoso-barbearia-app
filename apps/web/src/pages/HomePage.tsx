import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 safe-top safe-bottom">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-serif font-bold text-foreground">Sr. Cardoso</h1>
          <p className="text-muted-foreground">Barbearia</p>
          <p className="text-sm text-muted-foreground">Desde 2019</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Agende seu horário</CardTitle>
            <CardDescription>
              Escolha seu serviço, barbeiro e horário preferido
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>• Funcionamento: Segunda a Sábado, 08:00 às 19:00</p>
              <p>• Domingo: Fechado</p>
              <p>• Atendimento: 30 minutos por cliente</p>
            </div>
            <Link to="/agendar" className="block">
              <Button className="w-full" size="lg">
                Agendar agora
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

