# Contexto do Projeto - Barbearia Sr. Cardoso

## Infraestrutura e Banco de Dados (Firestore)

### Índices Compostos
Foram identificados e corrigidos problemas de performance e erros de execução relacionados a índices ausentes no Firestore.

| Coleção | Campos | Ordem | Motivo |
| :--- | :--- | :--- | :--- |
| `bookings` | `barberId` (ASC), `dateKey` (ASC) | ASC | Necessário para o resumo financeiro filtrado por barbeiro e período. |
| `bookings` | `barberId` (ASC), `slotStart` (ASC), `status` (ASC) | ASC | Otimização de consultas de agenda por profissional. |
| `bookings` | `customerId` (ASC), `slotStart` (DESC) | - | Histórico de agendamentos por cliente. |

### Ajustes Recentes (25/12/2025)
1. **Financeiro**: Corrigido erro ao trocar de barbeiro no painel administrativo. O erro era causado pela falta do índice composto `barberId` + `dateKey`. O índice foi criado via CLI `gcloud` e adicionado ao arquivo `firebase/firestore.indexes.json`.
2. **Toasts (Notificações)**: Ajustado o tempo de exibição de erros de 1.000.000ms para 5.000ms (5 segundos) para evitar que banners de erro fiquem travados na tela.
3. **Segurança Financeira**: Implementada trava no frontend para que barbeiros (não-master) visualizem apenas seus próprios dados, removendo a opção "Todos os profissionais" para este nível de acesso.

## Comunicação (WhatsApp)
- Implementado utilitário `generateNoShowMessage` para recuperação de clientes que faltaram.
- Padronização de links profundos (deep links) para abertura direta do WhatsApp Web/App.

## Listas Inteligentes (CRM)
- Overhaul completo da página `/admin/listas` com KPIs de Inativos, Aniversariantes e No-Shows.
- Implementação de busca em tempo real e ações rápidas de contato.
