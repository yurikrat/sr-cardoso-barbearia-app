# sr-cardoso-barbearia-app

App de agendamentos mobile-first para a Barbearia Sr. Cardoso.

## 📋 Descrição

Aplicativo web PWA para clientes agendarem horários na barbearia, com painel admin completo para gerenciamento de agendas, clientes e campanhas. Otimizado para abrir a partir de links no WhatsApp (iOS/Android).

**Projeto GCP:** `sr-cardoso-barbearia-prd`  
**Região:** `us-central1`

## 🏗️ Estrutura do Projeto

Este é um monorepo organizado em workspaces:

```
sr-cardoso-barbearia/
├── apps/
│   ├── web/              # Frontend React + Vite (cliente + admin)
│   └── server/           # Backend - Cloud Run (Express + Firestore)
├── packages/
│   └── shared/           # Tipos, schemas e utilitários compartilhados
├── scripts/              # Scripts de setup/manutenção
├── firebase/             # Configurações Firestore (rules, indexes)
└── Dockerfile            # Container para Cloud Run
```

### Separação Backend/Frontend

- **Frontend**: `apps/web/` - React, Vite, TypeScript, Tailwind CSS
- **Backend**: `apps/server/` - Cloud Run (Express), Firestore, Cloud Storage
- **Compartilhado**: `packages/shared/` - Types, schemas Zod, utilitários

## 🚀 Setup Inicial

### Pré-requisitos

- Node.js >= 18.0.0
- npm >= 9.0.0
- Google Cloud SDK (`gcloud`) instalado e configurado
- Projeto GCP criado com Firestore habilitado

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Google Cloud

```bash
gcloud init
gcloud config set project sr-cardoso-barbearia-prd
```

### 3. Configurar Variáveis de Ambiente

```bash
cp .env.example apps/web/.env
```

Edite `apps/web/.env`:

```bash
VITE_API_BASE_URL=https://your-cloud-run-url.run.app
```

#### Branding (upload de logo)

O upload do logo do painel admin usa **Cloud Storage**. No Cloud Run, é obrigatório configurar:

- `GCP_PROJECT_ID=sr-cardoso-barbearia-prd`
- `GCP_STORAGE_BUCKET=sr-cardoso-assets`

E garantir que o service account do Cloud Run tenha permissão no bucket (por exemplo `roles/storage.objectAdmin`).

### 4. Inicializar Barbeiros

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
npx tsx scripts/init-barbers.ts
```

**Service Account**: GCP Console > IAM & Admin > Service accounts > Create key (JSON)

### 5. Deploy Firestore Rules e Indexes
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
npx tsx scripts/init-barbers.ts
```

**Service Account**: GCP Console > IAM & Admin > Service accounts > Create key (JSON)

### 5. Deploy Firestore Rules e Indexes

```bash
# Deploy das regras de segurança
gcloud firestore rules create \
  --file=firebase/firestore.rules \
  --project=sr-cardoso-barbearia-prd

# Deploy dos índices
gcloud firestore indexes create \
  --file=firebase/firestore.indexes.json \
  --project=sr-cardoso-barbearia-prd
```

### 6. Deploy do Cloud Run

```bash
# Build e deploy do backend
gcloud run deploy sr-cardoso-barbearia \
  --source apps/server \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=sr-cardoso-barbearia-prd,GCP_STORAGE_BUCKET=sr-cardoso-assets" \
  --project=sr-cardoso-barbearia-prd
```

## 🧪 Desenvolvimento

### Arquivos de Configuração Firestore

Todos os arquivos de configuração do Firestore estão organizados em `firebase/`:

- `firebase/firestore.rules` - Regras de segurança
- `firebase/firestore.indexes.json` - Índices compostos

Deploy via:
```bash
gcloud firestore rules create --file=firebase/firestore.rules --project=sr-cardoso-barbearia-prd
gcloud firestore indexes create --file=firebase/firestore.indexes.json --project=sr-cardoso-barbearia-prd
```

### Deploy

```bash
# Build primeiro
npm run build

# Deploy do backend (Cloud Run)
gcloud run deploy sr-cardoso-barbearia \
  --source apps/server \
  --region us-central1 \
  --allow-unauthenticated \
  --project=sr-cardoso-barbearia-prd

# Deploy incremental (apenas regras/índices do Firestore)
gcloud firestore rules create --file=firebase/firestore.rules --project=sr-cardoso-barbearia-prd
gcloud firestore indexes create --file=firebase/firestore.indexes.json --project=sr-cardoso-barbearia-prd
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
- ✅ Login com JWT (backend)
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
- Cloud Run (Express + Node.js)
- Firestore (banco NoSQL)
- Cloud Storage (assets/branding)
- JWT-based authentication (admin)

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
5. Frontend chama `POST /api/bookings` no Cloud Run
6. API valida, cria booking, bloqueia slot, upsert customer
7. Retorna bookingId
8. Frontend redireciona para `/sucesso`

**Admin:**
1. Admin faz login (`/admin/login`)
2. Acessa agenda (`/admin/agenda`)
3. Visualiza bookings do dia/semana/mês
4. Pode cancelar, reagendar, marcar status (Concluir/Falta)
5. Envia WhatsApp via deep link (`wa.me`)

### Schema Firestore

**Collections:**
- `barbers/{barberId}` - Dados dos barbeiros
- `customers/{customerId}` - Perfis de clientes
- `bookings/{bookingId}` - Reservas
- `barbers/{barberId}/slots/{slotId}` - Slots (bookings/blocks)

## 🔐 Segurança

- ✅ JWT-based authentication (admin)
- ✅ Firestore Rules configuradas (deploy via gcloud)
- ✅ Validações server-side em todas as rotas (Zod)
- ✅ Transações Firestore para evitar duplo agendamento
- ✅ Validação de timezone (America/Sao_Paulo)
- ✅ Helmet + CORS configurados no Express

## 🔏 Privacidade (simples) + Opt-out

Este projeto foi desenhado para **coletar o mínimo necessário** para operar o agendamento e dar visibilidade ao admin:

- **Dados coletados no agendamento**: nome, sobrenome e WhatsApp.
- **Finalidade**: registrar e gerenciar a reserva, permitir contato (confirmação/reativação/aniversário, se aplicável).
- **Sem venda/compartilhamento**: os dados não devem ser compartilhados com terceiros fora do escopo operacional.
- **Calendário (iCal)**: o feed do barbeiro **evita PII** no título; detalhes são mínimos.

### Opt-out (manual)
Se um cliente pedir para parar de receber mensagens, o admin deve:

- Marcar/atualizar o cliente como **sem marketing** (`marketingOptIn=false`) no painel admin (ou não enviar mensagens).
- Opcional: registrar uma observação em `profile.notes`.

## 🧑‍💼 Runbook operacional (admin)

### Confirmar agendamento via WhatsApp (MVP)
- Abra a agenda do dia.
- Clique na reserva.
- Use o botão **“Enviar no WhatsApp”** (abre `wa.me` com mensagem pronta).
- Após enviar, marque **“WhatsApp enviado”** para manter o CRM consistente.

### Cancelar reserva
- Abra a reserva.
- Clique em **Cancelar**.
- (Opcional) Envie mensagem ao cliente via WhatsApp e marque o contato.

### Reagendar reserva
- Abra a reserva.
- Clique em **Reagendar**.
- Selecione novo dia/horário disponível.
- Confirme e (opcional) avise o cliente via WhatsApp.

### Bloquear horários (ex.: almoço)
- Abra a agenda do barbeiro.
- Use **Bloquear horários** e selecione intervalo.
- Informe um motivo (opcional).

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
- [ ] Domingo bloqueado no calendário + mensagem “Domingo fechado”
- [ ] Último horário disponível é 18:30 (encerra 19:00)
- [ ] “Hoje”: horários no passado não podem ser selecionados
- [ ] Corrida: dois clientes no mesmo slot → segundo recebe erro amigável e volta para escolher outro
- [ ] Login admin funciona
- [ ] Agenda admin carrega corretamente
- [ ] Bloqueio de horários funciona
- [ ] WhatsApp deep links funcionam
- [ ] PWA instalável (Android + iOS “Adicionar à Tela de Início”)
- [ ] Indicador offline aparece quando sem rede

**Backend:**
- [ ] Functions deployadas corretamente
- [ ] Firestore rules funcionam
- [ ] Validações funcionam
- [ ] Transações funcionam
- [ ] Feed iCal do barbeiro funciona (`/ical/barber/{barberId}/{token}.ics`)

## 🚀 Deploy Manual

### Processo

1. **Build:**
   ```bash
   npm run build
   ```

2. **Deploy:**
   ```bash
   gcloud run deploy sr-cardoso-api \
     --source apps/server \
     --region us-central1 \
     --allow-unauthenticated \
     --project=sr-cardoso-barbearia-prd
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

### Erro: "Unauthorized domain"
- Adicione o domínio autorizado nas configurações do Cloud Run ou CORS no backend

### Erro: "Permission denied" no Firestore
- Verifique as regras em `firebase/firestore.rules`
- Deploy: `gcloud firestore rules create --file=firebase/firestore.rules --project=sr-cardoso-barbearia-prd`

### Erro: "API not responding"
- Verifique se o Cloud Run está deployado: `gcloud run services list
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
└── server/                 # Backend (Cloud Run)
    └── src/
        ├── routes/          # Express routes (REST API)
        └── utils/           # Utilitários

packages/
└── shared/                 # Código compartilhado
    └── src/
        ├── types/           # TypeScript types
        ├── schemas/         # Zod schemas
        └── utils/           # Utilitários

firebase/                    # Configurações Firestore
├── firestore.rules
└── firestore.indexes.json
```

## 📄 Licença

Privado - Barbearia Sr. Cardoso

---

## ✅ Arquitetura Atual: GCP Cloud Run + Firestore

### Como funciona
- O **frontend não usa Firebase SDK** (sem `firebase/auth` e sem `firebase/firestore` no browser).
- O frontend chama uma **API REST** (Cloud Run) em:
  - `POST /api/bookings` (público)
  - `GET /api/availability?barberId=...&dateKey=YYYY-MM-DD` (público)
  - `POST /api/admin/login` + endpoints admin (protegidos por token)
  - `GET /ical/barber/{barberId}/{token}.ics` (feed iCal)
- O acesso ao Firestore é feito **no servidor** usando **IAM da Service Account do Cloud Run**.

### Variáveis de ambiente (server)
No Cloud Run (ou local), configure:
- `ADMIN_PASSWORD`: senha do painel admin (simples)
- `ADMIN_JWT_SECRET`: segredo para assinar tokens (JWT)
- `GCP_PROJECT_ID` (opcional): project id (em Cloud Run normalmente não precisa)
- `WEB_ORIGIN` (opcional): se quiser restringir CORS

### Rodar local
1. Build do web (opcional, se quiser servir estático pelo server):
   - `npm run build:web`
2. Rodar o server:
   - `npm run dev:server`
3. (Opcional) setar base da API no web em dev:
   - `VITE_API_BASE_URL=http://127.0.0.1:8080`

### Deploy no Cloud Run (manual)
Pré-requisitos:
- Firestore habilitado no projeto (modo nativo)
- APIs: Cloud Run, Cloud Build, Firestore
- Service Account do Cloud Run com permissão no Firestore (ex.: `roles/datastore.user`)

Comandos (exemplo):
- `gcloud config set project <SEU_PROJECT_ID>`
- `gcloud services enable run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com`
- Deploy via Dockerfile:
  - `gcloud run deploy sr-cardoso-barbearia --source . --region us-central1 --allow-unauthenticated --set-env-vars ADMIN_PASSWORD=...,ADMIN_JWT_SECRET=...`

> O container é construído usando `apps/server/Dockerfile` e já inclui o build do `apps/web`.

### Deploy SEM Cloud Build (script shell)
Se você não quer Cloud Build, use o script que faz **build local + docker push + deploy**:

- Script: `scripts/deploy-cloudrun.sh`
- Exemplo:
  - `./scripts/deploy-cloudrun.sh --project sr-cardoso-barbearia-prd --region us-central1 --service sr-cardoso-barbearia --admin-password '...' --admin-jwt-secret '...'`

### Índices do Firestore (obrigatório na 1ª vez)
O Firestore vai pedir índices para algumas queries do backend. Deploy via:

```bash
gcloud firestore indexes create --file=firebase/firestore.indexes.json --project=sr-cardoso-barbearia-prd
```

Ou crie manualmente no Console (Firestore → Indexes → Composite indexes):
- **bookings**: `barberId ASC`, `dateKey ASC`, `slotStart ASC`
- **bookings**: `barberId ASC`, `slotStart ASC`, `status ASC`
- **slots (subcoleção)**: `dateKey ASC`, `slotStart ASC`

---

## 🧠 Planejamento (UX + Arquitetura GCP)

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
- **Deep link de rota**: Cloud Run serve o SPA com suporte para abertura direta em `/agendar` e `/admin` a partir de links.
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
- Login via JWT (backend)
- Permissões:
  - barber: vê e gerencia apenas a própria agenda
  - owner: vê e gerencia ambas

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

#### Backend
- Google Cloud Run (Express + Node.js 20 + TypeScript)
- Firestore (Native mode)
- Cloud Storage (images/assets)
- JWT-based authentication (admin)

#### Hosting/Infra
- Cloud Run serves both API and static SPA (`express.static`)
- Firestore rules managed via gcloud CLI
- Billing: Cloud Run tem free tier generoso; Firestore tem cotas gratuitas. Com alertas de orçamento configurados, custos tendem a zero para tráfego baixo.

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

### APIs (Cloud Run)
- `POST /api/bookings` (público)
  - valida regras (domingo, faixa horária, intervalos de 30 min, dados)
  - transação: cria slot + booking + upsert do customer (primeira vez ou merge)
- `POST /api/admin/bookings/:id/cancel` (admin)
  - transação: atualiza booking + remove slot
- `POST /api/admin/bookings/:id/reschedule` (admin)
  - transação: cria novo slot, remove slot antigo, atualiza booking
- `POST /api/admin/slots/block` (admin)
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
- ClientApp → Cloud Run REST API → Firestore
- AdminApp → Cloud Run REST API (cancel/reschedule/block/markWhatsappSent/status) → Firestore
- AdminApp → WhatsApp Business (deep link) para envio manual

### Roadmap (entregas)
- MVP (1–2 semanas): Cliente agenda + bloqueio de horário + admin confirma/cancela/reagenda + deep link WhatsApp.
- V1 (hardening): (Opcional) App Check + melhorias anti-spam + exportação básica.
- V2 (automação WhatsApp): Migrar confirmação para WhatsApp Business Cloud API (templates + status delivery) mantendo o mesmo modelo de dados (só troca o “sender”).
GCP free tier first)
- Cloud Run: 2 milhões de requisições/mês gratuitas
- Firestore: 50k leituras + 20k escritas/dia gratuitas
- Cloud Storage: 5 GB gratuitos
- P
- Firestore + Cloud Functions: exigem plano Blaze (billing habilitado), mas têm cotas gratuitas; para uma barbearia com tráfego baixo, tende a ficar perto de zero se bem otimizado e com alertas de orçamento.
- Custos crescem principalmente com: muito tráfego, muitas leituras, e automação WhatsApp via API (cobrança por conversação).
server/` (Cloud Run: Express+Firestore+Cloud Storage)
- `packages/shared/` (schemas Zod, utils de datas, tipos)
- `firebase/` (firestore.rules, firestore.indexes.json — deploy via gcloud)
- `apps/functions/` (Cloud Functions TS)
- `packages/shared/` (schemas Zod, utils de datas, tipos)
- `firebase.json`, `firebase/firestore.rules`, `firebase/firestore.indexes.json`
