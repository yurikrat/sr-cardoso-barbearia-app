# GCP — Documentação viva (sr-cardoso-barbearia-prd)

Data de referência: 2025-12-28 (BRT)

Este documento descreve **o que existe** e **o que foi criado/alterado** na Google Cloud Platform para o projeto `sr-cardoso-barbearia-prd`, com foco em:
- Cloud Run (app)
- Rede/VPC (default)
- Serverless VPC Access Connector
- Secret Manager
- Compute Engine (Evolution API)

> Observação: este é um documento vivo. **Sempre que algo novo for criado/alterado na GCP, deve ser registrado aqui** (o que foi feito, por quem, quando, e com quais comandos).

---

## Identidade e Projeto

- Conta ativa (gcloud): `admin@grupomauri.com.br`
- Projeto (gcloud): `sr-cardoso-barbearia-prd`
- Região padrão de operação nesta doc: `us-central1`

---

## APIs habilitadas (confirmadas)

Habilitadas no projeto:
- `compute.googleapis.com`
- `run.googleapis.com`
- `secretmanager.googleapis.com`
- `vpcaccess.googleapis.com`

Comando usado:
- `gcloud services list --enabled --format="value(config.name)" | egrep "^(run.googleapis.com|compute.googleapis.com|secretmanager.googleapis.com|vpcaccess.googleapis.com)$"`

---

## Cloud Run

### Serviço: `sr-cardoso-barbearia`

- Região: `us-central1`
- URL: `https://sr-cardoso-barbearia-pspp7ojloq-uc.a.run.app`
- Latest ready revision (na coleta): `sr-cardoso-barbearia-00086-xj2`

Comando usado:
- `gcloud run services list --region us-central1 --format="table(metadata.name,status.url,status.latestReadyRevisionName)"`

### Variáveis de ambiente (na coleta)

Presentes:
- `ADMIN_PASSWORD` (via Secret Manager: `ADMIN_PASSWORD`, key `latest`)
- `ADMIN_JWT_SECRET` (via Secret Manager: `ADMIN_JWT_SECRET`, key `latest`)
- `GCP_STORAGE_BUCKET=sr-cardoso-assets`
- `GCP_PROJECT_ID=sr-cardoso-barbearia-prd`

Ausentes (necessárias para Evolution/WhatsApp):
- `EVOLUTION_BASE_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE_NAME`

Comando usado:
- `gcloud run services describe sr-cardoso-barbearia --region us-central1 --format="yaml(status.url,spec.template.spec.containers[0].env)"`

### VPC Access (na coleta)

- Não há connector configurado no serviço (sem `spec.template.spec.vpcAccess`).

Comando usado:
- `gcloud run services describe sr-cardoso-barbearia --region us-central1 --format="yaml(spec.template.spec.vpcAccess)"`

### Atualizações (2025-12-28)

1) Anexado Serverless VPC Access Connector (para acessar a VM por IP interno)
- Connector: `sr-cardoso-connector`
- Egress: `private-ranges-only`

Comando usado:
- `gcloud run services update sr-cardoso-barbearia --region us-central1 --vpc-connector sr-cardoso-connector --vpc-egress private-ranges-only`

1.1) Migração para Direct VPC egress (opção C) — 2025-12-28

- O serviço foi migrado para **Direct VPC egress** (sem Serverless VPC Access Connector).
- Evidência: annotation `run.googleapis.com/network-interfaces` presente e ausência de `run.googleapis.com/vpc-access-connector`.
- Egress mantido como `private-ranges-only`.

Comando usado (migração oficial):
- `gcloud run services update sr-cardoso-barbearia --region=us-central1 --clear-vpc-connector --network=default --subnet=default --vpc-egress=private-ranges-only`

2) Variáveis `EVOLUTION_*` configuradas
- `EVOLUTION_BASE_URL=http://10.128.0.2:8080` (IP interno da VM)
- `EVOLUTION_INSTANCE_NAME=sr-cardoso`

Comando usado:
- `gcloud run services update sr-cardoso-barbearia --region us-central1 --set-env-vars EVOLUTION_BASE_URL=http://10.128.0.2:8080,EVOLUTION_INSTANCE_NAME=sr-cardoso`

3) `EVOLUTION_API_KEY` via Secret Manager

- **Erro inicial**: permissão negada para a service account do Cloud Run ler o secret.
- **Correção**: concedido `roles/secretmanager.secretAccessor` no secret `EVOLUTION_API_KEY` para `sr-cardoso-barbearia-run@sr-cardoso-barbearia-prd.iam.gserviceaccount.com`.

Comandos usados:
- `gcloud secrets add-iam-policy-binding EVOLUTION_API_KEY --member="serviceAccount:sr-cardoso-barbearia-run@sr-cardoso-barbearia-prd.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"`
- `gcloud run services update sr-cardoso-barbearia --region us-central1 --set-secrets EVOLUTION_API_KEY=EVOLUTION_API_KEY:latest`

4) Atenção: `--set-env-vars` substitui a lista inteira de env

- Em uma atualização intermediária, o serviço ficou **sem** `ADMIN_PASSWORD` e `ADMIN_JWT_SECRET` (porque `--set-env-vars/--set-secrets` substituíram a lista de variáveis), o que causou `500` no `/api/admin/login`.
- Correção: re-deploy com **todas** as variáveis necessárias no mesmo comando (ADMIN + GCP + EVOLUTION).

Comando usado:
- `gcloud run services update sr-cardoso-barbearia --region us-central1 --set-env-vars GCP_STORAGE_BUCKET=sr-cardoso-assets,GCP_PROJECT_ID=sr-cardoso-barbearia-prd,EVOLUTION_BASE_URL=http://10.128.0.2:8080,EVOLUTION_INSTANCE_NAME=sr-cardoso --set-secrets ADMIN_PASSWORD=ADMIN_PASSWORD:latest,ADMIN_JWT_SECRET=ADMIN_JWT_SECRET:latest,EVOLUTION_API_KEY=EVOLUTION_API_KEY:latest`

---

## Rede (VPC/Subnets)

### VPC
- VPC: `default`

### Subnet (us-central1)
- Subnet: `default`
- Range: `10.128.0.0/20`

Comando usado:
- `gcloud compute networks subnets list --regions us-central1 --format="table(name,network,ipCidrRange,region)"`

---

## Serverless VPC Access (Connector)

### Connector: `sr-cardoso-connector`

Estado atual:
- Região: `us-central1`
- Network: `default`
- Range: `10.8.0.0/28`
- **Deletado** (para parar a cobrança fixa mensal).

Comando usado:
- `gcloud compute networks vpc-access connectors delete sr-cardoso-connector --region us-central1`

Comando de validação usado:
- `gcloud compute networks vpc-access connectors describe sr-cardoso-connector --region us-central1 --format="yaml(name,state,ipCidrRange,network,minInstances,maxInstances)"`

### Nota de custo (importante)

- O Serverless VPC Access Connector **tem custo próprio** (cobrança por instâncias/throughput).
- O parâmetro `minInstances` define uma “base” contínua; na CLI atual, o mínimo suportado é `2`.
- Para reduzir custo, foi aplicado `machineType=f1-micro` no connector.

Comando usado:
- `gcloud compute networks vpc-access connectors update sr-cardoso-connector --region us-central1 --machine-type f1-micro`

#### Histórico (2025-12-28)

1) Tentativa inicial (falhou por conflito de CIDR)
- Tentou-se criar com range `10.128.16.0/28`.
- Resultado: falha com mensagem de conflito com subnetwork.
- Observação: esse range está dentro de `10.128.0.0/20` (subnet default us-central1), portanto conflita.

2) Correção aplicada (remover e recriar)
- Ação: deletar o connector em `ERROR` e recriar usando um `/28` fora do range da subnet.
- Range escolhido: `10.8.0.0/28`.
- Resultado: connector criado com sucesso e ficou `READY`.

Comandos executados (em sequência):
- `gcloud services enable vpcaccess.googleapis.com --quiet`
- `gcloud compute networks vpc-access connectors list --region us-central1 --format="table(name,state,ipCidrRange)"`
- `gcloud compute networks vpc-access connectors delete sr-cardoso-connector --region us-central1 --quiet`
- `gcloud compute networks vpc-access connectors create sr-cardoso-connector --region us-central1 --network default --range 10.8.0.0/28 --min-instances 2 --max-instances 3 --quiet`
- `gcloud compute networks vpc-access connectors describe sr-cardoso-connector --region us-central1 --format="yaml(name,state,ipCidrRange,network)"`

---

## Secret Manager

Secrets existentes (na coleta):
- `ADMIN_PASSWORD` (criado em 2025-12-24)
- `ADMIN_JWT_SECRET` (criado em 2025-12-24)
- `EVOLUTION_API_KEY` (criado em 2025-12-28)
- `EVOLUTION_POSTGRES_PASSWORD` (criado em 2025-12-28)

Comando usado:
- `gcloud secrets list --format="table(name,createTime)"`

### Validação de versões (2025-12-28)

- `EVOLUTION_API_KEY`: versão `1` em `enabled`.
- `EVOLUTION_POSTGRES_PASSWORD`: versão `1` em `enabled`.

Comandos usados:
- `gcloud secrets versions list EVOLUTION_API_KEY --format="table(name,state,createTime)"`
- `gcloud secrets versions list EVOLUTION_POSTGRES_PASSWORD --format="table(name,state,createTime)"`

---

## Compute Engine

Instâncias existentes (na coleta):

### VM: `sr-cardoso-evolution`

- Zona: `us-central1-a`
- Machine type: `e2-micro`
- Disco: 30GB `pd-standard`
- Rede: `default` / subnet `default`
- IP interno: `10.128.0.2`
- IP público fixo (reservado): `136.119.212.151` (address `sr-cardoso-evolution-ip`)
- Tags de rede: `evolution`

### Configuração do SO (VM) — 2025-12-28

- SO confirmado: Ubuntu 22.04.5 LTS.
- Docker Engine + Docker Compose plugin instalados.
- Swapfile de 2GB criado e habilitado (necessário para 1GB RAM).

Comandos usados (VM):
- `sudo apt-get update`
- `sudo apt-get install -y ca-certificates curl gnupg`
- `curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg`
- `sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`
- `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`

Comandos usados:
- `gcloud compute instances create sr-cardoso-evolution --zone us-central1-a --machine-type e2-micro --boot-disk-size 30GB --boot-disk-type pd-standard --image-family ubuntu-2204-lts --image-project ubuntu-os-cloud --network default --subnet default --address sr-cardoso-evolution-ip --tags evolution`
- `gcloud compute instances describe sr-cardoso-evolution --zone us-central1-a --format="yaml(name,status,networkInterfaces[0].networkIP,networkInterfaces[0].accessConfigs[0].natIP,tags.items)"`

### Proteção contra reboot (VM) — 2025-12-28

- Compute Engine scheduling:
   - `automaticRestart: true`
   - `onHostMaintenance: MIGRATE`
- Criado serviço `systemd` para garantir `docker compose up -d` no boot:
   - Unit: `/etc/systemd/system/evolution.service`
   - `systemctl enable evolution.service`

Comandos usados (VM):
- `sudo systemctl enable evolution.service`
- `sudo systemctl start evolution.service`
- `sudo systemctl status evolution.service --no-pager -l`

### Stack Evolution (Docker) — 2025-12-28

- `docker compose up -d` executado em `/opt/evolution`.
- Containers em execução:
   - `evolution_api` (porta `8080` exposta)
   - `evo_postgres`
   - `evo_redis`

Validação na própria VM:
- `GET http://localhost:8080/` retornou `200` com `version: 2.3.7`.

Validação end-to-end (Cloud Run -> Evolution):
- `GET /api/admin/whatsapp/status` retornou `instanceExists: true`.
- `POST /api/admin/whatsapp/connect` retornou QR (`qrcodeBase64_len=13422`).

Validação pós-migração Direct VPC egress:
- `POST /api/admin/whatsapp/connect` retornou QR novamente (`qrcodeBase64_len=13358`).

#### Identidade do dispositivo (Evolution/Baileys) — 2025-12-28

O Evolution permite configurar **os rótulos** que aparecem no WhatsApp em "Dispositivos conectados" (isso é apenas display name, não garante contornar bloqueios do WhatsApp):

- `CONFIG_SESSION_PHONE_CLIENT` (nome do "dispositivo")
- `CONFIG_SESSION_PHONE_NAME` (nome do "browser")

Sugestão pragmática (neutro):

- `CONFIG_SESSION_PHONE_NAME=Chrome`
- `CONFIG_SESSION_PHONE_CLIENT=WhatsApp Web`

Aplicação (na VM):

- Editar `/opt/evolution/.env` e adicionar/ajustar as variáveis acima.
- Reiniciar stack: `cd /opt/evolution && sudo docker compose restart`

Comandos usados (VM):
- `cd /opt/evolution && sudo docker compose up -d --quiet-pull`
- `sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'`
- `curl -v --max-time 5 http://localhost:8080/`

### IP público fixo (custo estimado ~$4/mês)

- Reservado IP estático regional para a VM do Evolution.
- Nome: `sr-cardoso-evolution-ip`
- Região: `us-central1`
- IP: `136.119.212.151`
- Status: `RESERVED`

Comandos usados:
- `gcloud compute addresses create sr-cardoso-evolution-ip --region us-central1`
- `gcloud compute addresses describe sr-cardoso-evolution-ip --region us-central1 --format="yaml(name,address,status,region)"`

Implicação:
- A infraestrutura do Evolution API foi provisionada na VM e está acessível internamente via `http://10.128.0.2:8080` (Cloud Run com VPC Connector e egress `private-ranges-only`).

Comando usado:
- `gcloud compute instances list --format="table(name,zone,status,networkInterfaces[0].networkIP,networkInterfaces[0].accessConfigs[0].natIP)"`

---

## Firewall (Compute Engine)

### Regra: `allow-evolution-8080-from-uscentral1-subnet`

- Network: `default`
- Direction: `INGRESS`
- Allow: `tcp:8080`
- Source ranges: `10.128.0.0/20` (subnet `default` em `us-central1`)
- Target tags: `evolution` (aplica apenas na VM do Evolution)

Comando usado:
- `gcloud compute firewall-rules create allow-evolution-8080-from-uscentral1-subnet --network default --direction INGRESS --priority 1000 --action ALLOW --rules tcp:8080 --source-ranges 10.128.0.0/20 --target-tags evolution`

Regra removida (obsoleta):
- `allow-evolution-8080-from-serverless-connector`

---

## Próximos passos (Evolution)

1) Abrir o Admin `/admin/whatsapp` e tentar conectar via **QR Code**.
2) Se o QR falhar com a mensagem do WhatsApp (ex.: "não foi possível conectar novos dispositivos"), tentar o fallback **Código (sem QR)** informando o número em E.164 (ex.: `+55...`).
3) Confirmar no Admin que o status muda para conectado (e/ou `connectionState` aparece).
4) Enviar mensagem teste (após conectar) para validar `POST /message/sendText/{instanceName}`.

(Atualizar este documento após cada passo.)

---

## Incidente: WhatsApp recusou pareamento via QR (2025-12-28)

Sintoma:
- Ao escanear o QR do Admin `/admin/whatsapp`, o WhatsApp exibiu: **"não foi possivel conectar novos dispositivos no momento"**.
- O mesmo WhatsApp conseguiu conectar normalmente no `web.whatsapp.com` (indicando que o problema não era "limite geral" do WhatsApp Web naquele momento).

Diagnóstico (infra):
- VM com clock sincronizado (NTP ativo) e container com horário coerente.
- Container `evolution_api` com saída HTTPS funcional para `https://web.whatsapp.com/` (HTTP 200).
- Evolution retornando instância em estado `connecting` e gerando QR continuamente (qrcodeCount subindo), mas sem transicionar para `open`.

Correção operacional aplicada (reset de instância no Evolution):
- Foi executado delete da instância e recriação via API do Evolution.

Comandos executados (na VM, via docker exec):
- Descoberta de endpoints:
   - `DELETE /instance/delete/sr-cardoso` (funciona)
   - `POST /instance/restart/sr-cardoso` (funciona)
- Recriação:
   - `POST /instance/create` com payload `{ instanceName: "sr-cardoso", integration: "WHATSAPP-BAILEYS" }` retornou `201`.
- Novo QR gerado:
   - `GET /instance/connect/sr-cardoso` retornou `200` com `qrcodeBase64_len=13282`.

Próximo passo:
- Tentar escanear novamente com o QR recém-gerado e, após o scan, revalidar o estado em `GET /instance/connectionState/sr-cardoso`.

Mitigação/fallback adicionada no Admin (2025-12-28):
- O endpoint `POST /api/admin/whatsapp/connect` passou a suportar dois modos:
   - `mode=qr` (padrão): gera QR.
   - `mode=pairingCode`: tenta gerar pairing code passando `phoneNumber` (número do WhatsApp).
- Na UI do Admin, foi incluída a seleção "Código (sem QR)".

Desfecho (2025-12-28):
- A conexão **funcionou** usando o modo **Código (sem QR)** no Admin.
- Após conectar, o envio de mensagem (fluxo automático) passou a funcionar normalmente.

Passo-a-passo aplicado:
1) Admin → `/admin/whatsapp`
2) Em "Conectar" selecionar "Código (sem QR)".
3) Informar o número do WhatsApp em formato E.164 (ex.: `+55...`).
4) Clicar "Gerar código" e concluir o pareamento no celular.
5) Confirmar em "Status" que `connectionState` sai de `connecting` e fica `open/connected`.
6) Executar envio de mensagem teste (e validar o envio automático em reservas).
