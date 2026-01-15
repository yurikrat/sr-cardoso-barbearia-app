# Contexto do Projeto — Sr. Cardoso Barbearia

Este documento é o **contexto canônico** do projeto. A ideia é que, se alguém (humano ou IA) ler só isso, consiga entender rapidamente:
- o que o sistema faz,
- quais decisões já foram tomadas,
- onde ficam as coisas no código,
- e quais regras não podem ser quebradas.

> Regra de ouro: sempre que uma decisão importante mudar, atualize este arquivo.

---

## 1) O que é este projeto

Aplicativo web (PWA) para agendamento de horários da Barbearia Sr. Cardoso, com:
- **fluxo cliente** (mobile-first) para escolher serviço/barbeiro/data/horário e confirmar,
- **painel admin** para operar agenda, clientes, bloqueios, financeiro e mensagens.

---

## 2) Stack e arquitetura (visão prática)

### Frontend
- React + Vite + TypeScript
- Tailwind + shadcn/ui
- React Router
- TanStack Query (em alguns pontos)
- Luxon para datas (timezone e locale)

### Backend (híbrido)
Este repo tem **dois backends** usados em conjunto:

1) **API HTTP Express** em `apps/server/`
- Expõe rotas `/api/*` e `/api/admin/*`.
- Autenticação admin via **JWT** (Bearer token).

2) **Firebase Cloud Functions** em `apps/functions/`
- Funções exportadas em `apps/functions/src/index.ts`.
- Usadas principalmente para algumas ações administrativas (ex.: cancelar/rescheduler/bloquear/WhatsApp) via SDK do Firebase no frontend.

### Compartilhado
- `packages/shared/` contém tipos/schemas/utilitários compartilhados (ex.: validação e helpers de slot/date).

---

## 3) Estrutura do monorepo

```
.
├── apps/
│   ├── web/        # Frontend (cliente + admin)
│   ├── server/     # API Express (HTTP)
│   └── functions/  # Firebase Functions
├── packages/
│   └── shared/     # Tipos/schemas/utilitários comuns
├── firebase/       # rules/indexes
├── scripts/        # scripts de setup/manutenção
└── README.md
```

---

## 4) Regras de negócio (não negociáveis)

### Agenda e horário
- Timezone padrão: **`America/Sao_Paulo`**.
- Slots: **30 minutos**.
- Horário de operação típico: **08:00 até 18:30** (último slot 18:30).
- **PT-BR** em tudo: labels, status e formatação.

### Barbeiro “dono” / prioridade
- O barbeiro **Sr. Cardoso** tem ID fixo: **`sr-cardoso`**.
- Sempre que houver lista/tabs de barbeiros no admin, **Sr. Cardoso aparece primeiro**.

---

## 5) Autenticação e RBAC (Admin)

### Papéis (roles)
- `master`: acesso total ao admin e gestão de usuários/profissionais.
- `barber`: acesso **escopado** ao próprio `barberId`.

### Token e claims
- O frontend guarda o token em `localStorage` na chave: **`sr_admin_token`**.
- Claims decodificadas no frontend (sem validar assinatura) em `apps/web/src/lib/api.ts`.
- Claims esperadas:
  - `role`: `master` | `barber`
  - `username`: string
  - `barberId`: string | null (obrigatório quando role=barber)

### Login
- Endpoint: `POST /api/admin/login`
  - suporta modo legado `password` e modo novo `username + password`.

### Armazenamento de usuários admin
- Coleção Firestore: `adminUsers`
- Senha armazenada como hash **PBKDF2** (server-side).

### Gestão de profissionais e logins
- Master pode criar barbeiro + login automaticamente.
- Ao excluir usuário barbeiro:
  - remove o login em `adminUsers`
  - **desativa** o barbeiro em `barbers/{barberId}.active=false` para ele sumir das abas, sem apagar histórico.

---

## 6) Modelagem no Firestore (resumo)

Principais coleções (observadas no backend):
- `barbers`
  - docs por `barberId` (ex.: `sr-cardoso`)
  - campo importante: `active: boolean`
  - subcoleção: `barbers/{barberId}/slots`

- `bookings`
  - reservas e status

- `customers`
  - perfil e estatísticas (ex.: lastBookingAt)

- `adminUsers`
  - logins do admin com role e passwordHash

> Observação: o backend também usa `FieldValue.serverTimestamp()` e pode receber datas como ISO string.

---

## 7) API (fonte de verdade para o frontend)

A forma mais segura de saber “o que o frontend chama” é olhar:
- `apps/web/src/lib/api.ts`

### Endpoints principais (admin)
- `GET /api/admin/barbers`
- `GET /api/admin/bookings?barberId=...&dateKey=YYYY-MM-DD`
- `GET /api/admin/week-summary?barberId=...&startDateKey=YYYY-MM-DD&days=N`
- `POST /api/admin/bookings/:bookingId/status`
- `POST /api/admin/blocks`
- `GET /api/admin/customers`
- `GET /api/admin/customers/:customerId`
- `GET /api/admin/users` (master)
- `POST /api/admin/users` (master)
- `POST /api/admin/users/:username/reset-password` (master)
- `DELETE /api/admin/users/:username` (master)
- `POST /api/admin/me/password` (autenticado)
- `GET /api/admin/whatsapp/notification-settings` (master)
- `PUT /api/admin/whatsapp/notification-settings` (master)

### Endpoints de cron (públicos, protegidos por secret)
- `POST /api/cron/send-reminders`
- `POST /api/cron/process-queue`

### Endpoints principais (cliente)
- `GET /api/availability?barberId=...&dateKey=YYYY-MM-DD`
- `POST /api/bookings`

---

## 8) Frontend — páginas-chave

### Admin
- Agenda do Dia: `apps/web/src/pages/admin/AgendaDayPage.tsx`
  - Layout “tipo Google Agenda”: grade por horários + eventos posicionados.
  - Query params suportados:
    - `?date=YYYY-MM-DD&barber=barberId`

- Agenda da Semana: `apps/web/src/pages/admin/AgendaWeekPage.tsx`
  - Visão resumo; cards por dia.
  - Deve manter **o mesmo padrão visual** nas tabs para qualquer barbeiro.

- Usuários: `apps/web/src/pages/admin/UsersPage.tsx`
  - Master cadastra profissional (barbeiro) e gera senha.
  - Reset de senha, ativar/desativar e excluir.

- Clientes e listas inteligentes:
  - `apps/web/src/pages/admin/CustomersPage.tsx`
  - `apps/web/src/pages/admin/SmartListsPage.tsx`

### Cliente
- Fluxo principal: `apps/web/src/pages/BookingPage.tsx`
- Sucesso: `apps/web/src/pages/SuccessPage.tsx`

---

## 9) Localização (PT-BR) e datas

### Diretriz
- Nada de strings expostas em inglês (status, labels, botões etc.).

### Datas/Timestamps no admin
Algumas telas do admin recebem datas que podem vir como:
- `Date`
- `string`
- `number`
- Firestore Timestamp-like (`{ toDate() }`)

Para evitar crash do tipo **“toDate is not a function”**, usamos parsing defensivo local (`toDateSafe`) em:
- `apps/web/src/pages/admin/CustomersPage.tsx`
- `apps/web/src/pages/admin/SmartListsPage.tsx`

---

## 10) Convenções de UX já decididas

- `/admin` deve redirecionar para `/admin/login` quando deslogado, ou para `/admin/agenda` quando logado.
- ErrorBoundary/“Voltar ao início” deve respeitar contexto (admin vs cliente).
- Tabs de barbeiros devem ser **scroll horizontal** (evitar quebra/"espaço feio").

---

## 11) Variáveis de ambiente importantes

### Frontend (Vite)
- `VITE_API_BASE_URL` (base do backend Express; sem barra no final)

### Server (Express)
- `ADMIN_JWT_SECRET` (obrigatório)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` (bootstrap de master, opcional)
- `GCP_PROJECT_ID`
- `GCP_STORAGE_BUCKET` (bucket para branding/assets)
- `WEB_ORIGIN` (CORS)
- `CANCEL_LINK_PEPPER`
- `APP_BASE_URL` (URL pública do app, ex: `https://srcardoso.com.br`)
- `CRON_SECRET` (autenticação dos cron jobs)

### Evolution API (WhatsApp)
- `EVOLUTION_BASE_URL` (IP interno da VM, ex: `http://10.128.0.2:8080`)
- `EVOLUTION_INSTANCE_NAME` (nome da instância, ex: `sr-cardoso`)
- `EVOLUTION_API_KEY` (via Secret Manager)

---

## 12) Como rodar (atalho)

No root:
- `npm install`
- `npm run dev` (frontend, porta 5173)
- `npm run dev:server` (backend Express, porta 8080)
- `npm run build` (build de todos os workspaces)
- `npm run build:shared` (necessário antes de outros builds)
- `npm run type-check` (verificação de tipos)

Detalhes completos e deploy estão no `README.md`.

---

## 13) Checklist rápido antes de mudar algo grande

- A mudança mantém PT-BR em toda a UI?
- Não quebrou a regra de timezone `America/Sao_Paulo`?
- Master continua conseguindo ver/selecionar qualquer barbeiro?
- Barbeiro (`role=barber`) continua escopado ao próprio `barberId`?
- Sr. Cardoso continua primeiro nas listas/tabs?

---

## 14) Pontos de atenção / dívidas técnicas (conscientes)

- `toDateSafe` está duplicado em mais de uma página (poderia virar util compartilhado).
- O backend é híbrido (server + functions). Antes de mover endpoints, confirmar o que está sendo chamado via `api.ts` e o que está sendo chamado via Firebase SDK.

---

## 15) Histórico de decisões (curto)

- Implementado RBAC (master vs barber) com JWT e claims.
- Criado fluxo de criação automática: profissional + login + senha gerada.
- Excluir usuário barbeiro desativa o barbeiro para remover da agenda sem perder histórico.

---

## 16) Notificações WhatsApp Automáticas (Evolution API)

### Visão Geral
O sistema envia notificações WhatsApp automaticamente para clientes via Evolution API:
- **Confirmação de agendamento**: enviada imediatamente ao criar uma reserva
- **Lembrete**: enviado X minutos antes do atendimento (configurável, padrão 60 min)
- **Cancelamento**: enviado quando o cliente cancela pelo link

### Configuração (Firestore: `settings/whatsapp-notifications`)
```typescript
{
  confirmationEnabled: boolean,      // Ativa/desativa confirmação automática
  reminderEnabled: boolean,          // Ativa/desativa lembretes
  reminderMinutesBefore: number,     // Minutos antes para enviar lembrete (padrão: 60)

  // Mensagens (texto simples). O sistema monta o restante automaticamente.
  confirmationMessage: string,
  reminderMessage: string,
  cancellationMessage: string
}
```

### Como o texto final é montado
- O admin edita apenas o “miolo” da mensagem (texto livre) no painel.
- O sistema adiciona automaticamente: serviço (nome legível), barbeiro, data/hora e link de cancelamento (na confirmação).
- O nome do serviço vem do catálogo do financeiro (`settings/finance.services[].label`). Se o catálogo não existir, usa defaults (ex.: `cabelo_barba` → `Cabelo + Barba`).

### Fila de Retry (Firestore: `whatsappMessageQueue`)
Mensagens que falham são salvas para reenvio automático:
```typescript
{
  bookingId: string,
  customerId: string,
  messageType: 'confirmation' | 'reminder' | 'cancellation',
  phoneE164: string,
  messageText: string,
  status: 'pending' | 'sent' | 'failed',
  attempts: number,                 // Máximo: 3 tentativas
  maxAttempts: number,
  createdAt: Date,
  lastAttemptAt?: Date,
  lastError?: string
}
```

### Endpoints
- `GET /api/admin/whatsapp/notification-settings` - Carrega configurações
- `PUT /api/admin/whatsapp/notification-settings` - Salva configurações

#### Cron (Cloud Scheduler)
- `POST /api/cron/send-reminders` - Processa lembretes pendentes
- `POST /api/cron/process-queue` - Reprocessa fila de retry
- Autenticação: header `x-cron-secret: <CRON_SECRET>` (o backend também aceita `x-cron-key` por compat)

### Fluxo de Envio
1. **Ao criar booking** (`POST /api/bookings`):
   - Se `confirmationEnabled=true`, envia confirmação com link de cancelamento
   - Se falhar, adiciona à fila de retry

2. **Cron de lembretes** (a cada 15 min):
   - Query bookings onde `slotStart` está dentro do intervalo configurado
  - Filtra por `status=booked` e sem `reminderSentAt`
  - Envia lembrete e marca `reminderSentAt`

3. **Ao cancelar** (link público de cancelamento):
  - O cancelamento público usa `POST /api/public/cancel/:cancelCode`
  - Se `cancellationEnabled=true`, envia confirmação de cancelamento

### UI Admin (`/admin/whatsapp`)
Seção "Notificações Automáticas" permite:
- Ativar/desativar cada tipo de notificação
- Configurar tempo do lembrete (em minutos)
- Editar templates de mensagem (texto livre)
- Preview das mensagens com dados de exemplo
- Agenda do Dia redesenhada para layout em grade; Agenda da Semana deve seguir padrão visual consistente.

