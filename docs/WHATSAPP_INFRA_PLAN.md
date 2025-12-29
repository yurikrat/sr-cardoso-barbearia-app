# Plano de Infraestrutura WhatsApp (Evolution API)

Este documento detalha a arquitetura e configuração para rodar a Evolution API (v2) no Google Cloud Free Tier, integrada ao backend Cloud Run existente.

## 1. Infraestrutura (Google Cloud Free Tier)

### VM Compute Engine
- **Tipo**: `e2-micro` (2 vCPUs "burstable", 1GB RAM).
- **Região**: `us-central1` (ou `us-east1`, `us-west1` para Free Tier).
- **Disco**: 30GB Standard Persistent Disk.
- **Rede**:
  - **IPv4 Externo**: Sim (Standard/Ephemeral). Necessário para saída de internet (WhatsApp/Docker Hub) sem custos de Cloud NAT.
  - **IPv4 Interno**: Fixo ou dinâmico na VPC (ex: `10.128.0.2`).

### Custo Estimado
- **VM**: $0.00 (Free Tier).
- **IP Público**: ~$3.72/mês (se a VM ficar ligada 24/7).
- **Tráfego**: Gratuito até 1GB egress (exceto China/Austrália).

## 2. Arquitetura de Rede e Segurança

### Fluxo de Comunicação
1.  **Cloud Run -> Evolution (Envio de Mensagens)**:
    - O Cloud Run utiliza **Direct VPC Egress**.
    - Acessa a VM pelo **IP Interno** (ex: `http://10.128.0.2:8080`).
    - Tráfego não sai para a internet pública.

2.  **Evolution -> Cloud Run (Webhooks)**:
    - A Evolution envia eventos (QR Code, Mensagens) para a URL pública do Cloud Run (ex: `https://api.srcardoso.com/webhook/...`).
    - **Segurança**: O Cloud Run deve validar um token secreto no header ou query param.

3.  **VM -> Internet (WhatsApp)**:
    - A VM usa seu IP Público para conectar aos servidores do WhatsApp.

### Firewall
- **Regra de Entrada (Ingress)**:
  - **Bloquear**: Porta 8080 para `0.0.0.0/0` (Internet).
  - **Permitir**: Porta 8080 apenas para o range da Subnet do Cloud Run (VPC).
    - *Nota*: Com Direct VPC Egress, o tráfego vem dos IPs da subnet, não de um IP fixo.

## 3. Configuração da VM (Otimização para 1GB RAM)

Como a `e2-micro` tem pouca RAM, é **obrigatório** configurar SWAP e limitar recursos no Docker.

### Configuração de SWAP
Executar na VM logo após a criação:

```bash
# Criar arquivo de 2GB
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Persistir no fstab
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Ajustar swappiness (opcional, para usar menos swap se possível)
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
```

## 4. Stack Docker (Evolution v2 + Redis + Postgres)

> Fechado: para o nosso caso (barbearia), **1 instância só (global)** é a melhor escolha.
> O “menor custo” vem mais de como você roda o Evolution (DB/Redis/VM) do que de criar múltiplas instâncias.

Arquivo `docker-compose.yml` otimizado com limites de CPU/RAM.

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: evo_postgres
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    command:
      - postgres
      - -c
      - shared_buffers=64MB
      - -c
      - work_mem=4MB
      - -c
      - maintenance_work_mem=32MB
      - -c
      - max_connections=50
    volumes:
      - pgdata:/var/lib/postgresql/data
    mem_limit: 220m
    cpus: 0.50

  redis:
    image: redis:7-alpine
    container_name: evo_redis
    restart: always
    command: ["redis-server","--save","","--appendonly","no","--maxmemory","96mb","--maxmemory-policy","allkeys-lru"]
    mem_limit: 110m
    cpus: 0.20

  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: evolution_api
    restart: always
    depends_on:
      - postgres
      - redis
    ports:
      - "8080:8080"
    env_file:
      - .env
    environment:
      # Limita o heap do Node.js para evitar OOM
      NODE_OPTIONS: "--max-old-space-size=256"
    volumes:
      - evolution_instances:/evolution/instances
    mem_limit: 520m
    cpus: 0.80

volumes:
  evolution_instances:
  pgdata:

```

### Opção mais barata (sem Redis)

> Redis é “recomendado” em algumas configurações, mas para baixo volume pode ser viável rodar **sem Redis** e usar cache local.
> Valide rapidamente (create/connect/sendText) na sua própria VM/versão antes de assumir em produção.

- Remova o serviço `redis` e o `depends_on: redis`.
- Ajuste as variáveis de cache (exemplo):

```ini
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
```

### Observação sobre DB persistente

Algumas instalações/builds permitem desligar persistência (ex.: `DATABASE_ENABLED=false`) para reduzir custo e dependências, mas isso **não é garantido** para todos os cenários/versões/recursos.
Se a meta for “conectar 1 WhatsApp e mandar mensagem”, a forma honesta de decidir é validar em 5 minutos com `create → connect → sendText` e observar estabilidade.

### Arquivo `.env`

```ini
# Auth global (header: apikey)
AUTHENTICATION_API_KEY=SUA_CHAVE_SECRETA_AQUI

# Banco de Dados (Postgres)
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:${POSTGRES_PASSWORD}@postgres:5432/evolution?schema=public

# Redis (Cache)
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379/6
CACHE_LOCAL_ENABLED=false

# Desabilitar serviços não utilizados para economizar RAM
OPENAI_ENABLED=false
DIFY_ENABLED=false
CHATWOOT_ENABLED=false
RABBITMQ_ENABLED=false
SQS_ENABLED=false

# Configurações do Servidor
SERVER_PORT=8080

# Senhas
POSTGRES_PASSWORD=SUA_SENHA_DB_AQUI
```

## 5. Integração com Backend (Node.js/Firestore)

### Fluxo de Envio (Cloud Run -> Evolution)
1.  Sistema solicita envio de mensagem.
2.  Cloud Run faz request POST para `http://10.x.x.x:8080/message/sendText/...`.
3.  Cloud Run salva log no Firestore (`wa_messages`).

### Fluxo de Recebimento (Evolution -> Cloud Run)
1.  Evolution recebe evento (ex: `MESSAGES_UPSERT` ou `CONNECTION_UPDATE`).
2.  Evolution chama webhook configurado: `https://api-cloudrun.com/webhook/whatsapp`.
3.  Cloud Run valida token de segurança.
4.  Cloud Run processa evento e atualiza Firestore (`wa_instances` ou `wa_messages`).

## 6. Validação e Testes

Antes de integrar, acesse o Swagger da Evolution para confirmar os payloads:
- URL: `http://<IP_DA_VM>:8080/docs`
- Verificar endpoints:
  - `/instance/create`
  - `/message/sendText/{instance}`
  - `/instance/fetchInstances` (fallback)
  - Formato dos Webhooks.

## 7. Contrato do Evolution API (v2.3.7) — endpoints confirmados (fonte: repo oficial)

> Objetivo: usar endpoints **reais** (sem inventar). Alguns links do API Reference v2 podem retornar 404 dependendo do site; a validação final deve ser feita na **nossa imagem/versão rodando**.

### Autenticação (obrigatória)
- Header: `apikey: <AUTHENTICATION_API_KEY>`
- MVP: usar **apenas a global key** (não depender de “token por instância”).

### Base URL / prefixos
- Padrão esperado na VM (Docker): `http://<IP_DA_VM>:8080`
- Prefixo: **sem** `/api` e **sem** `/v2` (o router é montado na raiz `/`).

### Endpoints necessários (MVP)

1) Health / versão
- `GET /`
- Como validar em 2 minutos:
  - `curl http://<IP_DA_VM>:8080/`
  - Esperado: JSON com `message` + `version`.

2) Create instance
- `POST /instance/create`
- Headers: `apikey`
- Body (mínimo):
  - `instanceName: string`
  - `integration: string` (WhatsApp Baileys)
  - opcional `qrcode: boolean`
  - opcional `webhook: { enabled, url, events, headers, byEvents, base64 }`
- Como validar:
  - Postman/curl com `apikey`; se `401/403`, a key está errada; se `404`, baseUrl/prefix/porta.

3) Conectar / obter QR
- `GET /instance/connect/{instanceName}`
- Headers: `apikey`
- Em algumas coleções/instalações pode aceitar query param `?number=...` (pairing code em cenários específicos).
- Resposta esperada: estrutura com `qrcode.base64` e/ou `pairingCode` quando desconectado.
- Como validar:
  - Chamar 2 vezes: na primeira deve gerar QR; após escanear, tende a retornar estado sem QR.

4) Status (connectionState)
- `GET /instance/connectionState/{instanceName}`
- Headers: `apikey`
- Resposta esperada: estado `open | connecting | close | ...`.

> Importante: não dependa cegamente de `connectionState`. Em alguns ambientes há relatos de 404/mismatch (proxy/manager/versão).
> Se `connectionState` falhar, o `sendText` normalmente retorna erro claro quando não está conectado.

4.1) Fallback: listar instâncias
- `GET /instance/fetchInstances`
- Headers: `apikey`
- Uso: fallback para checar se a instância existe quando rotas de state falham.

5) Enviar mensagem texto
- `POST /message/sendText/{instanceName}`
- Headers: `apikey`
- Body mínimo:
  - `number: string` (destino)
  - `text: string`
  - opcionais: `delay`, `linkPreview`, `mentioned`, etc.
- Como validar:
  - Enviar para um número de teste; se erro “not connected”, conectar instância primeiro.

6) Configurar webhook (por instância)

> Webhook: o path pode variar por versão/coleção.
> Solução barata e robusta: no backend, implementar “tentar A, senão tentar B” (capability detection).

6.1) Preferido (documentação)
- `POST /webhook/instance`
- Headers: `apikey`
- Body esperado (mínimo):
  - `instanceName: string`
  - `enabled: boolean`
  - `url: string` (Cloud Run público)
  - `events: string[]`
  - opcional: `headers`, `byEvents`, `base64`

6.2) Fallback (coleções antigas)
- `POST /webhook/set/{instanceName}`
- Headers: `apikey`
- Body esperado: equivalente ao acima

7) Consultar webhook
- `GET /webhook/find/{instanceName}`
- Headers: `apikey`

> Regra: após setar webhook (A ou B), sempre validar com `GET /webhook/find/{instanceName}`.

### Checklist anti-404 (sanity)
- `baseUrl`: `http://` vs `https://` (sem SSL por padrão na VM)
- Porta: `8080` exposta do container
- Prefixo: não usar `/api` ou `/v2`
- Formato do path: `/<recurso>/<acao>/{instanceName}`
- Testar com/sem trailing slash
- Confirmar que `GET /` retorna `version` antes de testar o resto

## 8. Planejamento de Integração (MVP) no projeto (sem código)

> Contexto canônico: monorepo com `apps/web` (admin/cliente), `apps/server` (Cloud Run), `packages/shared` (schemas/utils). Timezone `America/Sao_Paulo` e UI PT-BR.

### 8.1 Leitura do repo (checklist do que inspecionar)

#### Frontend contract (confirmado no repo)
- `apps/web/src/lib/api.ts`
  - Base URL via `VITE_API_BASE_URL`.
  - Admin auth: token salvo no `localStorage` com chave **`sr_admin_token`**.
  - Requests admin enviam `Authorization: Bearer <token>`.
  - Login: `POST /api/admin/login`.

#### Backend routes (confirmado no repo)
- `apps/server/src/routes/public.ts` (rotas públicas):
  - `GET /api/health`
  - `GET /api/branding`
  - `GET /api/services`
  - `GET /api/availability`
  - `GET /api/calendar/booking.ics`
  - `GET /api/calendar/google`
  - `POST /api/public/cancel/:cancelCode`
  - `GET /api/customers/lookup`
  - `POST /api/bookings`

- `apps/server/src/routes/admin.ts` (rotas admin):
  - Auth: middleware `requireAdmin()` lê o Bearer token; RBAC via `requireMaster()` e checagens por `barberId`.
  - Rotas já existentes e relevantes para WhatsApp hoje:
    - `POST /api/admin/bookings/:bookingId/whatsapp-sent` (marca WhatsApp como enviado; aplica escopo por barbeiro)
  - Outras rotas admin existentes (base para padrão de implementação):
    - `POST /api/admin/login`
    - `GET/POST/DELETE /api/admin/users/*`
    - `GET/POST /api/admin/barbers` e `GET /api/admin/barbers/:barberId`
    - `PUT /api/admin/barbers/:barberId/schedule`
    - `GET/PUT /api/admin/finance/config`, `GET /api/admin/finance/summary`
    - `GET /api/admin/bookings`, `POST /api/admin/bookings/:bookingId/cancel|reschedule|status`
    - `GET /api/admin/week-summary`
    - `POST /api/admin/blocks`
    - `GET /api/admin/customers` e `GET /api/admin/customers/:customerId` e `GET /api/admin/customers/:customerId/bookings`
    - Branding: `GET /api/admin/branding`, `PATCH /api/admin/branding`, upload `POST /api/admin/branding/upload?type=logo`
    - Branding público: `GET /api/public/branding/logo` e `GET /api/public/branding/logo-preview`

#### Firebase Functions
- O contexto menciona `apps/functions`, porém **não há pasta `apps/functions/src` no workspace atual** (confirmar se foi removida/movida). Enquanto isso, o plano assume centralização total no Cloud Run.

#### Shared
- `packages/shared`: manter Zod schemas e utilitários compartilhados (ex.: normalização/validação de WhatsApp E.164) como fonte de verdade do contrato.

### 8.2 Desenho do módulo no Admin (UX mínima)
- Admin > WhatsApp > “Conectar WhatsApp”
  - Cartão de status: Conectado / Conectando / Desconectado
  - Botão “Gerar novo QR”
  - Exibição do QR (base64) e horário de geração
  - Botão “Enviar mensagem teste” (destino + texto)

Webhook (fase 2 / opcional):
- Só implementar agora se você realmente precisa “capturar mensagens recebidas”.
- Se/Quando implementar: seguir a seção de endpoints tolerantes a versão (tentar `/webhook/instance`, fallback `/webhook/set/{instance}`, validar com `GET /webhook/find/{instance}`).

Permissões:
- `master`: tudo (criar instância, conectar/QR, webhook, mensagem teste, logs).
- `barber`: somente leitura de status e ações vinculadas às próprias reservas (se habilitado), sem gestão de instância/webhook.

### 8.3 Modelagem no Firestore (MVP)
- `whatsappInstances/{instanceName}`
  - `instanceName`, `status`, `lastConnectionState`, `lastQrAt`, `ownerScope`, `createdAt`, `updatedAt`
- `whatsappOutbound/{id}`
  - `idempotencyKey` (ex: `bookingId:eventType:toE164`), `bookingId?`, `toE164`, `templateKey?`, `text`, `status`, `providerMessageId?`, `error?`, `createdAt`
- `whatsappInboundEvents/{id}`
  - `instanceName`, `eventType`, `payloadRaw`, `receivedAt`, `secretOk`
- `whatsappConfig/singleton`
  - `evolutionBaseUrl`, `webhookUrl`, `webhookEvents[]`, `webhookSecretRef`, `updatedAt`

### 8.4 API no nosso backend (contrato interno)

#### Estado atual (já existe)
- `POST /api/admin/bookings/:bookingId/whatsapp-sent`
  - Uso atual: marcar envio manual (wa.me) como “sent” e atualizar `stats.lastContactAt` do cliente.
  - RBAC: se `role=barber`, só permite quando `booking.barberId === admin.barberId`.

#### MVP (a criar no Cloud Run)

Todos com JWT (Bearer):
- `GET  /api/admin/whatsapp/status`
  - tenta `connectionState`; fallback `fetchInstances`
- `POST /api/admin/whatsapp/connect` (master)
  - chama `GET /instance/connect/{instance}` e devolve `qrcode.base64` pro front
- `POST /api/admin/whatsapp/send`
  - chama `POST /message/sendText/{instance}` com `{ number, text }`
  - opcional: grava log simples no Firestore para auditoria

Webhook (fase 2 / opcional):
- `POST /api/admin/whatsapp/webhook/config` (set)
  - backend faz capability detection: tenta `/webhook/instance`, se 404 tenta `/webhook/set/{instance}`, valida com `GET /webhook/find/{instance}`
- `GET  /api/admin/whatsapp/webhook/config` (find)
- `POST /api/webhooks/evolution` (público; validado por segredo)

Validações (padrão do projeto):
- Definir Zod schemas em `packages/shared` para request/response.
- Erros esperados:
  - `401` sem JWT
  - `403` sem role
  - `409` instância não conectada / operação inválida
  - `502` quando Evolution estiver indisponível

### 8.5 Segurança, observabilidade e DoD

Segurança:
- Secrets apenas em env vars/Secret Manager (ex.: `AUTHENTICATION_API_KEY`, `WEBHOOK_SECRET`).
- Webhook do Evolution não assina payload: nosso endpoint deve exigir segredo (`x-evolution-webhook-secret` ou query `?secret=`).
- Rate limit em endpoints de envio (evitar spam).
- Logs com máscara de número quando possível.

Observabilidade:
- Logs estruturados com `requestId`, `instanceName`, `route`, `durationMs`.

Definition of Done (validável):
- Endpoints do Evolution confirmados na versão real rodando (evidência: requests/responses de `GET /`, create, connect, connectionState, sendText; e, se habilitado na fase 2, set/find webhook).
- Admin mostra QR e status.
- Mensagem teste enviada com sucesso.
- Webhook (se habilitado na fase 2): recebe ao menos 1 evento real e persiste no Firestore com `secretOk=true`.

---

## 9. Sistema de Notificações Automáticas (Implementado - 2025-12-29)

### Visão Geral
Sistema completo de notificações WhatsApp automáticas para clientes:

1. **Confirmação de agendamento**: enviada automaticamente ao criar reserva
2. **Lembrete**: enviado X minutos antes do atendimento (configurável)
3. **Cancelamento**: enviado quando cliente cancela pelo link público

### Serviço de Notificações
- **Localização**: `apps/server/src/services/whatsappNotifications.ts`
- **Responsabilidades**:
  - Carregar configurações do Firestore
  - Montar mensagens a partir de templates
  - Enviar via Evolution API
  - Gerenciar fila de retry para falhas

### Configurações (Firestore: `settings/whatsapp-notifications`)
```typescript
interface WhatsAppNotificationSettings {
  confirmationEnabled: boolean;
  reminderEnabled: boolean;
  reminderMinutesBefore: number;  // padrão: 60

  // Mensagens (texto livre). O sistema adiciona automaticamente os detalhes.
  confirmationMessage: string;
  reminderMessage: string;
  cancellationMessage: string;
}
```

### Como o texto final é montado
- O admin edita apenas o “miolo” (texto livre) no painel.
- O sistema adiciona automaticamente: serviço (nome legível), barbeiro, data/hora e link de cancelamento (na confirmação).
- O nome do serviço vem do catálogo do financeiro (`settings/finance.services[].label`). Se o catálogo não existir, usa defaults.

### Fila de Retry (Firestore: `whatsappMessageQueue`)
```typescript
interface WhatsAppMessageQueueItem {
  bookingId: string;
  customerId: string;
  messageType: 'confirmation' | 'reminder' | 'cancellation';
  phoneE164: string;
  messageText: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;        // máx: 3
  maxAttempts: number;
  createdAt: Date;
  lastAttemptAt?: Date;
  lastError?: string;
}
```

### Endpoints Adicionados
- `GET /api/admin/whatsapp/notification-settings` - Carrega config (master)
- `PUT /api/admin/whatsapp/notification-settings` - Salva config (master)

Cron (Cloud Scheduler):
- `POST /api/cron/send-reminders` - Processa lembretes
- `POST /api/cron/process-queue` - Reprocessa fila de retry
- Autenticação: header `x-cron-secret: <CRON_SECRET>` (compat: `x-cron-key`)

### Integração no Fluxo de Booking

#### Criação de reserva (`POST /api/bookings`)
```
Cliente cria booking → API salva no Firestore → Envia confirmação WhatsApp
                                              ↓
                                    Se falhar → Adiciona à fila de retry
```

Observação (Firestore index):
- O cron de lembretes consulta `bookings` por `status` e `slotStart`, então é necessário o índice composto `bookings(status ASC, slotStart ASC)` (definido em `firebase/firestore.indexes.json`).

#### Cancelamento público (`POST /api/public/cancel/:cancelCode`)
```
Cliente cancela → API atualiza booking → Envia msg de cancelamento WhatsApp
```

### Cloud Scheduler (Configuração)

Para lembretes e retries automáticos, criar jobs no GCP (exemplo):

```bash
# Criar job para enviar lembretes a cada 15 min
gcloud scheduler jobs create http whatsapp-send-reminders \
  --location=us-central1 \
  --schedule="*/15 * * * *" \
  --uri="https://sr-cardoso-barbearia-....run.app/api/cron/send-reminders" \
  --http-method=POST \
  --headers="x-cron-secret=<CRON_SECRET>" \
  --time-zone="America/Sao_Paulo"

# Criar job para processar retry queue a cada 5 min
gcloud scheduler jobs create http whatsapp-process-retry \
  --location=us-central1 \
  --schedule="*/5 * * * *" \
  --uri="https://sr-cardoso-barbearia-....run.app/api/cron/process-queue" \
  --http-method=POST \
  --headers="x-cron-secret=<CRON_SECRET>" \
  --time-zone="America/Sao_Paulo"
```

### UI Admin (`/admin/whatsapp`)
Seção "Notificações Automáticas" permite:
- Toggle para ativar/desativar cada tipo de notificação
- Campo para configurar minutos do lembrete
- Textarea para editar mensagens (texto livre)
- Preview com dados de exemplo
