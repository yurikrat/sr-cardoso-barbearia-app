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
  - Formato dos Webhooks.
