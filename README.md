# sr-cardoso-barbearia-app

App de agendamentos mobile-first para a Barbearia Sr. Cardoso.

## 📋 Descrição

Aplicativo web PWA para clientes agendarem horários na barbearia, com painel admin completo para gerenciamento de agendas, clientes e campanhas. Otimizado para abrir a partir de links no WhatsApp (iOS/Android).

## 🏗️ Estrutura do Projeto

Este é um monorepo organizado em workspaces:

```
sr-cardoso-barbearia/
├── apps/
│   ├── web/              # Frontend React + Vite (cliente + admin)
│   └── functions/        # Backend - Firebase Cloud Functions
├── packages/
│   └── shared/           # Tipos, schemas e utilitários compartilhados
├── scripts/              # Scripts de setup/manutenção
├── firebase/             # Configurações Firebase (rules, indexes)
├── firebase.json         # Configuração principal Firebase
└── .firebaserc           # Aliases de projetos Firebase
```

### Separação Backend/Frontend

- **Frontend**: `apps/web/` - React, Vite, TypeScript, Tailwind CSS
- **Backend**: `apps/functions/` - Firebase Cloud Functions, TypeScript
- **Compartilhado**: `packages/shared/` - Types, schemas Zod, utilitários

## 🚀 Setup Inicial

### Pré-requisitos

- Node.js >= 18.0.0
- npm >= 9.0.0
- Firebase CLI (`npm install -g firebase-tools`)

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Firebase

```bash
firebase login
firebase init
```

Durante o `firebase init`, selecione:
- ✅ Firestore
- ✅ Functions
- ✅ Hosting
- ✅ Use an existing project

### 3. Configurar Variáveis de Ambiente

```bash
cp .env.example apps/web/.env
```

Edite `apps/web/.env` com suas credenciais do Firebase:

```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

**Onde encontrar**: Firebase Console > Project Settings > General > Your apps

### 4. Inicializar Barbeiros

```bash
export FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
npx tsx scripts/init-barbers.ts
```

**Service Account**: Firebase Console > Project Settings > Service accounts > Generate new private key

### 5. Configurar Firebase Auth

No Firebase Console:
- Authentication > Sign-in method > Habilite "Email/Password"
- Authentication > Users > Add user (crie usuário admin)

### 6. Deploy Firestore Rules e Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## 🛠️ Scripts Disponíveis

- `npm run dev` - Inicia servidor de desenvolvimento do frontend
- `npm run build` - Build de todos os workspaces
- `npm run build:web` - Build apenas do frontend
- `npm run build:functions` - Build apenas das functions
- `npm run lint` - Executa ESLint em todos os workspaces
- `npm run format` - Formata código com Prettier
- `npm run format:check` - Verifica formatação

## 🔥 Firebase

### Arquivos do Firebase

Todos os arquivos de configuração do Firebase estão organizados:

- `firebase.json` - Configuração principal (raiz)
- `.firebaserc` - Aliases de projetos (raiz)
- `firebase/firestore.rules` - Regras de segurança
- `firebase/firestore.indexes.json` - Índices compostos

### Deploy

```bash
# Build primeiro
npm run build

# Deploy completo
firebase deploy

# Deploy seletivo
firebase deploy --only hosting      # Frontend
firebase deploy --only functions    # Backend
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### Ambientes

```bash
firebase use dev   # Ambiente de desenvolvimento
firebase use prod  # Ambiente de produção
```

## 🧪 Desenvolvimento

### Frontend

```bash
cd apps/web
npm run dev
```

Acesse: `http://localhost:5173`

### Backend (Functions)

```bash
cd apps/functions
npm run serve
```

## 📱 Funcionalidades

### Cliente
- ✅ Agendamento em 6 passos (mobile-first)
- ✅ Seleção de serviço (Cabelo, Barba, Cabelo+Barba)
- ✅ Escolha de barbeiro (Sr Cardoso ou Emanuel Fernandes)
- ✅ Seleção de data e horário (08:00 - 18:30, intervalos de 30min)
- ✅ Formulário de dados (nome, sobrenome, WhatsApp)
- ✅ Revisão antes de confirmar
- ✅ Adicionar ao calendário (ICS/Google Calendar)
- ✅ PWA instalável
- ✅ Persistência de estado no localStorage

### Admin
- ✅ Login com Firebase Auth
- ✅ Agenda do dia por barbeiro
- ✅ Agenda da semana (visão geral)
- ✅ Gerenciamento de reservas (visualizar, cancelar)
- ✅ Bloqueio de horários (intervalos)
- ✅ Módulo de clientes (listagem, busca, estatísticas)
- ✅ Listas inteligentes:
  - Clientes inativos (30+ dias)
  - Aniversariantes (próximos 7 dias)
  - Ranking de no-show
- ✅ Integração de calendário (feed iCal para barbeiros)
- ✅ Deep links WhatsApp para confirmações
- ✅ Envio de mensagens de reativação e aniversário

## 🏗️ Arquitetura

### Stack Tecnológica

**Frontend:**
- React 19 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui
- React Router (roteamento)
- TanStack Query (estado servidor)
- Luxon (datas/timezones)
- PWA (vite-plugin-pwa)

**Backend:**
- Firebase Cloud Functions (serverless)
- Firestore (banco NoSQL)
- Firebase Auth (autenticação)
- Firebase Hosting (CDN)

**Compartilhado:**
- TypeScript types
- Zod schemas
- Utilitários (Luxon)

### Fluxo de Dados

**Agendamento (Cliente):**
1. Cliente acessa `/agendar`
2. Seleciona serviço → barbeiro → data → horário
3. Preenche dados (nome, sobrenome, WhatsApp)
4. Revisa e confirma
5. Frontend chama `createBooking()` Function
6. Function valida, cria booking, bloqueia slot, upsert customer
7. Retorna bookingId
8. Frontend redireciona para `/sucesso`

**Admin:**
1. Admin faz login (`/admin/login`)
2. Acessa agenda (`/admin/agenda`)
3. Visualiza bookings do dia/semana
4. Pode cancelar, reagendar, bloquear slots
5. Envia WhatsApp via deep link (`wa.me`)

### Schema Firestore

**Collections:**
- `barbers/{barberId}` - Dados dos barbeiros
- `customers/{customerId}` - Perfis de clientes
- `bookings/{bookingId}` - Reservas
- `barbers/{barberId}/slots/{slotId}` - Slots (bookings/blocks)

## 🔐 Segurança

- ✅ Autenticação Firebase Auth (admin)
- ✅ Firestore Rules configuradas
- ✅ Validações server-side em todas as Functions (Zod)
- ✅ Transações Firestore para evitar duplo agendamento
- ✅ Validação de timezone (America/Sao_Paulo)

## 📝 Padrões de Nomenclatura

### Arquivos
- **Componentes**: `PascalCase.tsx` (ex: `BookingPage.tsx`)
- **Hooks**: `useCamelCase.ts` (ex: `useAuth.ts`)
- **Utils**: `camelCase.ts` (ex: `dates.ts`)
- **Types**: `camelCase.ts` (ex: `booking.ts`)

### Código
- **Variáveis/Funções**: `camelCase`
- **Constantes**: `UPPER_SNAKE_CASE` ou `PascalCase`
- **Componentes**: `PascalCase`
- **Interfaces**: `PascalCase`

## 🧪 Testes

### Checklist Básico

**Frontend:**
- [ ] Fluxo completo de agendamento funciona
- [ ] Login admin funciona
- [ ] Agenda admin carrega corretamente
- [ ] Bloqueio de horários funciona
- [ ] WhatsApp deep links funcionam

**Backend:**
- [ ] Functions deployadas corretamente
- [ ] Firestore rules funcionam
- [ ] Validações funcionam
- [ ] Transações funcionam

## 🚀 Deploy Manual

### Processo

1. **Build:**
   ```bash
   npm run build
   ```

2. **Selecionar Ambiente:**
   ```bash
   firebase use dev   # ou prod
   ```

3. **Deploy:**
   ```bash
   firebase deploy
   ```

### Checklist Antes de Deploy

- [ ] Build executado com sucesso
- [ ] Testes locais passando
- [ ] Variáveis de ambiente configuradas
- [ ] Firestore rules revisadas
- [ ] Índices do Firestore criados
- [ ] Barbeiros inicializados
- [ ] Usuário admin criado

## 🆘 Troubleshooting

### Erro: "Firebase: Error (auth/unauthorized-domain)"
- Adicione o domínio em Firebase Console > Authentication > Settings > Authorized domains

### Erro: "Permission denied" no Firestore
- Verifique as regras em `firebase/firestore.rules`
- Deploy: `firebase deploy --only firestore:rules`

### Erro: "Function not found"
- Verifique se as functions foram deployadas: `firebase deploy --only functions`

### PWA não instala
- Verifique se está usando HTTPS (ou localhost)
- Verifique o console do navegador para erros

## 📦 Estrutura Detalhada

```
apps/
├── web/                    # Frontend
│   ├── src/
│   │   ├── components/     # Componentes React
│   │   │   ├── admin/      # Componentes admin
│   │   │   └── ui/         # Componentes UI base
│   │   ├── pages/          # Páginas/rotas
│   │   │   └── admin/      # Páginas admin
│   │   ├── hooks/          # Custom hooks
│   │   ├── contexts/       # React contexts
│   │   ├── lib/            # Configurações
│   │   └── utils/          # Utilitários
│   └── public/             # Assets estáticos
│
└── functions/              # Backend
    └── src/
        ├── functions/       # Cloud Functions
        └── utils/           # Utilitários

packages/
└── shared/                 # Código compartilhado
    └── src/
        ├── types/           # TypeScript types
        ├── schemas/         # Zod schemas
        └── utils/           # Utilitários

firebase/                    # Configurações Firebase
├── firestore.rules
└── firestore.indexes.json
```

## 📄 Licença

Privado - Barbearia Sr. Cardoso

---

## 🧠 Planejamento (UX + Arquitetura GCP/Firebase)

### Objetivo
Criar um app web mobile-first (PWA) para clientes agendarem horários e um painel admin completo para a barbearia gerenciar duas agendas independentes (Sr Cardoso e Emanuel Fernandes), com slots de 30 min, funcionamento 08:00–19:00 (último horário 18:30), todos os dias exceto domingo, e confirmação por WhatsApp sem API no MVP (admin envia pela conta do WhatsApp Business da barbearia com mensagem pré-preenchida).

O fluxo do cliente será otimizado para o cenário real: o usuário chega pelo link no WhatsApp da barbearia, abre dentro do navegador interno do WhatsApp (iOS/Android) e precisa concluir o agendamento com pouquíssimos toques, sem fricção.

### Mobile-first e WhatsApp-first (ponto de entrada)
- **Entrada principal**: link único para o agendamento (`/agendar`). Opcionalmente, suportar parâmetros para reduzir cliques, ex.: `?barber=sr-cardoso` ou `?barber=emanuel`.
- **WhatsApp in-app browser (iOS/Android)**:
  - evitar popups e fluxos que dependam de “abrir nova aba”
  - tudo acontece na mesma aba, com estados claros de carregamento
  - sem dependência de cookies de terceiros; cliente não precisa login
- **Performance percebida**:
  - SPA com carregamento rápido e skeletons
  - code splitting por rota (admin só carrega em `/admin`)
- **Interação touch**:
  - alvos de toque ≥ 44px
  - CTA primário fixo/“sticky” no rodapé respeitando `safe-area-inset-bottom`
- **Pré-visualização no WhatsApp**:
  - Open Graph (título/descrição/imagem) no `index.html` do Hosting para o link ter preview bonito
- **PWA**:
  - instalável (Android e iOS “Adicionar à Tela de Início”)
  - manifest, ícones, `theme-color` e layout compatível com notch/safe area

### Regras de negócio (fonte de verdade)
- **Serviços**: cabelo, barba, cabelo_barba (todos com 30 min).
- **Horários**: slots a cada 30 min das 08:00 até 18:30 (encerra 19:00).
- **Dias**: aberto todos os dias exceto domingo.
- **Fuso**: `America/Sao_Paulo`.
- **Concorrência**: não pode existir duplo agendamento no mesmo `barberId + slotStart`.
- **Dados do cliente**: Nome, Sobrenome, WhatsApp (formato E.164, default BR +55).
- **Confirmação WhatsApp (MVP)**: o sistema gera o texto; o admin clica em “Enviar no WhatsApp Business” e o WhatsApp abre com a mensagem pronta.
- **Cadastro de cliente (CRM)**: cada agendamento cria/atualiza um registro único de cliente (dedupe por WhatsApp), para permitir histórico, recorrência e futuras campanhas.

### Casos de borda e microdetalhes (para nada escapar)
- **Deep link de rota**: Firebase Hosting com rewrite para SPA suportar abrir direto em `/agendar` e `/admin` a partir de links.
- **Timezone**: cálculo/validação do slot sempre em `America/Sao_Paulo` no backend (evita agendar errado se o celular estiver em outro fuso).
- **Último slot**: 18:30 (encerrando 19:00) — o front exibe isso explicitamente.
- **Domingo**: calendário desabilita e exibe mensagem “Domingo fechado”.
- **WhatsApp**: normalização do número (remove máscara, valida BR e converte para E.164) + armazenamento normalizado para busca/admin.
- **Deep link WhatsApp**: usar `https://wa.me/<E164>?text=<urlencoded>` (abre no app no mobile e no WhatsApp Web no desktop).
- **Corrida**: se dois clientes tentarem o mesmo horário, o segundo recebe erro amigável e volta para selecionar outro slot.
- **Preview do link**: garantir `title/description/og:image` no HTML inicial para o link do WhatsApp ficar “clicável”.
- **PWA no iOS**: respeitar safe area, evitar elementos colados no rodapé e testar no Safari + in-app browser do WhatsApp.

### UX — Cliente (fluxo principal)
#### Páginas
- `/`: landing curta + CTA “Agendar agora” + informações de funcionamento.
- `/agendar`: fluxo em passos (Stepper) com validação progressiva.
- `/sucesso`: confirmação na tela + instruções.

#### Mobile-first (detalhes de layout e interação)
- Um passo por tela no celular (reduz carga cognitiva e evita scroll longo).
- CTA sempre visível: botão “Continuar/Confirmar” fixo no rodapé (com safe area).
- Persistência suave: manter seleções do usuário (serviço/barbeiro/data) em memória + `localStorage` para não perder se o WhatsApp recarregar a aba.
- Inputs otimizados:
  - WhatsApp com `inputmode="tel"`, máscara BR e normalização para E.164
  - `autocomplete` (`given-name`, `family-name`, `tel`)
- Seleção de data/hora pensada para touch:
  - calendário simples e legível; domingos sempre desabilitados
  - horários em chips/lista com feedback instantâneo
- Resiliência:
  - estados offline/sem rede
  - erro de corrida tratado com mensagem amigável e retorno para seleção de horário

#### Fluxo (Stepper)
1. Serviço (cards grandes): Cabelo | Barba | Cabelo + Barba.
2. Barbeiro: Sr Cardoso | Emanuel Fernandes (cada um com badge “Agenda independente”).
3. Data (calendário): domingos desabilitados; datas passadas desabilitadas.
4. Horário (grade de slots):
   - mostra slots livres/ocupados/bloqueados
   - para “hoje”, esconde slots no passado
   - feedback de carregamento e estados vazios (“Sem horários neste dia”)
5. Seus dados: Nome, Sobrenome, WhatsApp (máscara + validação).
6. Revisão e confirmar: resumo + botão “Confirmar agendamento”.

#### Pós-reserva (sem WhatsApp API)
- Tela de sucesso: “Reserva registrada. Você receberá a confirmação pelo WhatsApp da barbearia.”
- (Opcional UX) Botão “Falar com a barbearia no WhatsApp” para o cliente abrir conversa (não substitui a confirmação oficial).

#### Detalhes de UX que elevam qualidade
- Velocidade: pré-carregar disponibilidade assim que selecionar barbeiro+data.
- Clareza: sempre mostrar “30 min por atendimento” e “Domingo fechado”.
- Confiabilidade: ao confirmar, exibir “Verificando disponibilidade…” e lidar com corrida (“Este horário acabou de ser reservado. Selecione outro”).
- Acessibilidade: navegação por teclado, contraste alto, estados de foco visíveis.

### UX — Admin (painel completo)
#### Acesso
- Login (Firebase Auth): email/senha.
- Rotas admin protegidas.

#### Principais telas
- Agenda (Dia): tabs por barbeiro + lista por horário (08:00→18:30).
- Agenda (Semana): visão resumida por dia (contagem de reservas, blocos).
- Detalhe da reserva: dados do cliente, serviço, status, ações.
- Mobile admin: no celular, priorizar visão “Dia” com ações rápidas (confirmar/cancelar/reagendar/enviar WhatsApp) sem tabelas pesadas.

#### Ações admin
- Confirmar/Cancelar/Reagendar reserva.
- Bloquear horários (slot único ou intervalo) com motivo (ex.: almoço).
- Enviar confirmação WhatsApp:
  - botão abre deep link para o número do cliente com mensagem pré-preenchida
  - após enviar, admin marca “WhatsApp enviado” (manual)
  - mensagem padrão inclui: nome do cliente, serviço, barbeiro, data/hora, endereço e instrução curta (ex.: chegar 5 min antes)
- Buscar por nome/WhatsApp.

#### Modelo de acesso (admin)
- Contas separadas por barbeiro (Firebase Auth).
- Permissões:
  - barber: vê e gerencia apenas a própria agenda
  - owner: vê e gerencia ambas (opcional, se você quiser um terceiro login “Barbearia”)

### Design System (derivado da marca)
> Valores iniciais (ajustaremos com amostragem do arquivo original da logo).

- **Cores**:
  - bg: preto/couro (`#0B0C0D`)
  - surface: carvão (`#121316`)
  - text: marfim (`#F3E8D4`)
  - muted: cinza quente (`#A6A09A`)
  - accent: dourado envelhecido (`#C6A15B`)
  - danger: vermelho sóbrio (`#D05454`)
- **Tipografia**: Inter (UI) + Fraunces (títulos/brand).
- **Grid/Spacing**: escala 4/8px.
- **Mobile e acessibilidade**: touch targets ≥ 44px, safe-area no rodapé, teclado não cobrindo CTA e foco visível/contraste alto.
- **Componentes base**: Button, Card, Stepper, Calendar, SlotPill, Dialog, Toast, DataTable.
- **Iconografia**: lucide-react.

### Stack (uma escolha por camada)
#### Frontend (Web/PWA)
- React + Vite + TypeScript
- Tailwind CSS (tokens via CSS variables)
- shadcn/ui (Radix UI) para componentes acessíveis
- React Router (rotas cliente/admin)
- TanStack Query (cache/requests)
- React Hook Form + Zod (forms + validação)
- Luxon (datas/horários com timezone)
- vite-plugin-pwa (PWA + manifest + cache estático)

#### Backend (serverless)
- Firebase Cloud Functions (Node 20 + TypeScript)
- Firestore (Native mode)
- Firebase Auth (admin)
- Firebase App Check (web) (opcional; só se começar a ter abuso/spam no link público)

#### Hosting/Infra (GCP-first, custo)
- Firebase Hosting (SPA + PWA)
- Functions e Firestore no Firebase (GCP gerenciado)
- Billing (importante): Cloud Functions exige projeto no plano Blaze (billing habilitado). Para manter custo praticamente zero, configurar orçamento + alertas no GCP e acompanhar quotas.
- GitHub Actions para deploy (ambiente dev/prod) *(cancelado depois; deploy manual preferido).*

### Modelo de dados (Firestore)
#### Coleções
- `barbers/{barberId}`
  - `name`, `active`
  - `calendarFeedToken` (string secreta para assinatura iCal do barbeiro)
- `customers/{customerId}` (cadastro único por WhatsApp)
  - `identity: {firstName,lastName,whatsappE164}`
  - `profile: {birthday?: 'YYYY-MM-DD', birthdayMmdd?: 'MMDD', notes?: string, tags?: string[]}`
  - `consent: {marketingOptIn: boolean, marketingOptInAt?: timestamp, marketingOptOutAt?: timestamp}`
  - `stats: {firstBookingAt?: timestamp, lastBookingAt?: timestamp, lastCompletedAt?: timestamp, totalBookings: number, totalCompleted: number, noShowCount: number, lastContactAt?: timestamp}`
- `bookings/{bookingId}` (histórico e auditoria)
  - `customerId`, `barberId`, `serviceType`
  - `slotStart` (timestamp), `dateKey` (YYYY-MM-DD)
  - `customer: {firstName,lastName,whatsappE164}`
  - `status: booked|confirmed|completed|cancelled|no_show|rescheduled`
  - `whatsappStatus: pending|sent`
  - `createdAt, updatedAt, confirmedAt?, completedAt?, cancelledAt?, noShowAt?, rescheduledFrom?`
- `barbers/{barberId}/slots/{slotId}` (lock de disponibilidade)
  - `slotStart`, `dateKey`
  - `kind: booking|block`
  - `bookingId?`
  - `reason?` (para block)
  - `createdAt, updatedAt`

#### Estratégia anti-duplo-agendamento
- `slotId = YYYYMMDD_HHmm` (ex.: `20251223_0830`).
- `createBooking` faz transação: se slot doc existir → falha; senão cria slot + booking.

### APIs (Cloud Functions)
- `createBooking` (público)
  - valida regras (domingo, faixa horária, intervalos de 30 min, dados)
  - transação: cria slot + booking + upsert do customer (primeira vez ou merge)
- `adminCancelBooking` (admin)
  - transação: atualiza booking + remove slot
- `adminRescheduleBooking` (admin)
  - transação: cria novo slot, remove slot antigo, atualiza booking
- `adminBlockSlots` (admin)
  - cria slots `kind=block` para intervalo
- `adminMarkWhatsappSent` (admin)
  - marca `whatsappStatus=sent`
  - atualiza `customers/{customerId}` em `stats.lastContactAt`
- `barberCalendarIcs` (público, protegido por token no URL)
  - gera feed iCal (ICS) da agenda do barbeiro para assinatura em iPhone/Android/Google Calendar
  - inclui apenas informações mínimas no título (ex.: “Atendimento - 30min”) para evitar PII em calendários

### CRM (Clientes, recorrência e campanhas — sem WhatsApp API no MVP)
#### Como o cadastro de cliente funciona
- Chave do cliente: `customerId` determinístico a partir do WhatsApp (ex.: hash do E.164), para evitar duplicidade.
- Criação automática: no primeiro agendamento, o backend cria `customers/{customerId}`; nos próximos, atualiza `stats.lastBookingAt` e incrementa contadores.
- “Data de aniversário só uma vez”:
  - `profile.birthday` é opcional e editável no admin
  - no app do cliente, podemos não pedir no primeiro agendamento (para não derrubar conversão) e oferecer depois um “Completar cadastro (opcional)” — ou pedir como opcional (colapsado) com explicação
- Consentimento (simples):
  - manter simples: um checkbox “Quero receber lembretes/ofertas” (opcional) e um opt-out no admin

#### Listas inteligentes (alto valor, baixo custo)
- Inativos 30+ dias: clientes com `consent.marketingOptIn=true` e `stats.lastCompletedAt` (ou `lastBookingAt` no MVP) menor que “hoje - 30 dias”.
- Aniversariantes do dia/semana: query por `profile.birthdayMmdd` (com cuidado em virada de ano) e opt-in ativo.
- No-show: ranking por `stats.noShowCount` (ajuda a decidir confirmação reforçada).

#### Como “notificar” sem API (agora) e com API (depois)
- Agora (MVP): o admin vê listas e usa botão “Abrir WhatsApp” (`wa.me`) com mensagem pronta; após enviar, marca “contato realizado” (atualiza `lastContactAt`) para evitar spam.
- Depois (V2): trocar o “sender” por WhatsApp Business Cloud API e automatizar lembretes/aniversários sem mudar o modelo de dados (apenas adiciona status de entrega).

### Segurança e permissões
- Cliente: não escreve direto no Firestore; apenas chama `createBooking`.
- Admin: autenticação obrigatória; regras Firestore limitam leitura/escrita por role.
- Validações server-side (essencial e simples): timezone, faixa horária, domingo, intervalos de 30 min e dedupe de slot (transação).
- Anti-spam (simples, se precisar): honeypot no form e um limite básico por número/intervalo (pode ser adicionado só quando necessário).
- Privacidade (simples): armazenar o mínimo (nome + WhatsApp) e evitar PII em links públicos (ex.: feed iCal do barbeiro).

### Integração com calendários (iPhone/Android/Google Calendar)
#### Cliente (após reservar)
- Botão “Adicionar ao calendário”:
  - gera/baixa um arquivo ICS do compromisso (funciona no iOS/Android/desktop)
  - opcional: link “Adicionar ao Google Calendar” (URL de criação de evento) para quem usa Google

#### Barbeiros (agenda própria sincronizada automaticamente)
- Cada barbeiro terá uma assinatura iCal privada (webcal):
  - URL do tipo `/ical/barber/{barberId}/{calendarFeedToken}.ics`
  - o barbeiro adiciona uma única vez no iPhone/Android/Google Calendar
  - a agenda sincroniza automaticamente quando houver novos agendamentos/cancelamentos (conforme a frequência de atualização do app de calendário)
- Essa abordagem evita OAuth/integrações caras e é a mais estável/custo-zero para “GCP first”.

### Observabilidade
- Logs estruturados nas Functions (Cloud Logging).
- Métricas básicas: número de reservas/dia, taxa de cancelamento.

### Arquitetura (visão macro)
- ClientApp → `createBooking` (Cloud Functions) → Firestore
- AdminApp → Firestore + Functions (cancel/reschedule/block/markWhatsappSent)
- AdminApp → WhatsApp Business (deep link) para envio manual

### Roadmap (entregas)
- MVP (1–2 semanas): Cliente agenda + bloqueio de horário + admin confirma/cancela/reagenda + deep link WhatsApp.
- V1 (hardening): (Opcional) App Check + melhorias anti-spam + exportação básica.
- V2 (automação WhatsApp): Migrar confirmação para WhatsApp Business Cloud API (templates + status delivery) mantendo o mesmo modelo de dados (só troca o “sender”).

### Custos (free tier first)
- Firebase Hosting: geralmente zero no início.
- Firestore + Cloud Functions: exigem plano Blaze (billing habilitado), mas têm cotas gratuitas; para uma barbearia com tráfego baixo, tende a ficar perto de zero se bem otimizado e com alertas de orçamento.
- Custos crescem principalmente com: muito tráfego, muitas leituras, e automação WhatsApp via API (cobrança por conversação).

### Estrutura sugerida do repositório
- `apps/web/` (React+Vite)
- `apps/functions/` (Cloud Functions TS)
- `packages/shared/` (schemas Zod, utils de datas, tipos)
- `firebase.json`, `firebase/firestore.rules`, `firebase/firestore.indexes.json`
