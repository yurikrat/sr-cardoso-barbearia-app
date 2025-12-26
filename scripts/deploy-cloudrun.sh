#!/usr/bin/env bash
set -euo pipefail

# Deploy manual (SEM Cloud Build) para o Caminho B (Cloud Run + Firestore via IAM).
# Estratégia: build local -> docker build -> push Artifact Registry -> gcloud run deploy.
#
# Requisitos locais:
# - gcloud instalado e autenticado: `gcloud auth login`
# - docker instalado e rodando
# - permissões no projeto (Artifact Registry + Cloud Run + IAM + Firestore)
#
# Uso:
#   ./scripts/deploy-cloudrun.sh \
#     --project sr-cardoso-barbearia-prd \
#     --region us-central1 \
#     --service sr-cardoso-barbearia
#
# Opcional (se não usar Secret Manager):
#   --admin-password 'SENHA_FORTE' \
#   --admin-jwt-secret 'SEGREDO_LONGO'
#   --web-origin https://seu-dominio.com
#

PROJECT_ID=""
REGION="us-central1"
SERVICE_NAME="sr-cardoso-barbearia"
AR_REPO="sr-cardoso"
IMAGE_TAG=""
ADMIN_PASSWORD=""
ADMIN_JWT_SECRET=""
WEB_ORIGIN=""
SETUP=false

die() { echo "Erro: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    --repo) AR_REPO="${2:-}"; shift 2 ;;
    --tag) IMAGE_TAG="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --admin-jwt-secret) ADMIN_JWT_SECRET="${2:-}"; shift 2 ;;
    --web-origin) WEB_ORIGIN="${2:-}"; shift 2 ;;
    --setup) SETUP=true; shift ;;
    -h|--help) sed -n '1,120p' "$0"; exit 0 ;;
    *) die "flag desconhecida: $1" ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || die "--project é obrigatório"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "$IMAGE_TAG" ]]; then
  if command -v git >/dev/null 2>&1; then
    IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || true)"
  fi
fi
[[ -n "$IMAGE_TAG" ]] || IMAGE_TAG="$(date +%Y%m%d%H%M%S)"

echo "== Deploy Cloud Run (sem Cloud Build) =="
echo "Project: $PROJECT_ID"
echo "Region : $REGION"
echo "Service: $SERVICE_NAME"
echo "Repo   : $AR_REPO"
echo "Tag    : $IMAGE_TAG"

command -v gcloud >/dev/null 2>&1 || die "gcloud não encontrado"
command -v docker >/dev/null 2>&1 || die "docker não encontrado"

gcloud config set project "$PROJECT_ID" >/dev/null

if [ "$SETUP" = true ]; then
  echo "== [SETUP] Habilitando APIs necessárias =="
  gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    firestore.googleapis.com \
    cloudresourcemanager.googleapis.com \
    iam.googleapis.com \
    >/dev/null

  echo "== [SETUP] Garantindo Artifact Registry repo =="
  if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$AR_REPO" \
      --repository-format=docker \
      --location="$REGION" \
      --description="Sr Cardoso - Docker images" >/dev/null
  fi
fi

echo "== Configurando docker auth para Artifact Registry =="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "== Build do monorepo (web + server) =="
# Otimização: O build é feito dentro do Docker (multi-stage).
# Não precisamos buildar localmente, pois o Dockerfile fará isso.
# npm run build:web >/dev/null
# npm run build:server >/dev/null

echo "== Docker build (local) =="
if ! docker buildx version >/dev/null 2>&1; then
  die "docker buildx não está disponível. Atualize o Docker Desktop."
fi

# Cloud Run exige linux/amd64. Em Macs ARM, o build padrão gera arm64 e falha no deploy.
echo "== Docker buildx (linux/amd64) + push =="
# Garante que existe um builder ativo
if ! docker buildx inspect sr-cardoso-builder >/dev/null 2>&1; then
  docker buildx create --name sr-cardoso-builder --use >/dev/null
else
  docker buildx use sr-cardoso-builder >/dev/null
fi

# --provenance=false evita gerar manifest list/attestations que podem confundir alguns runtimes
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  -f apps/server/Dockerfile \
  -t "$IMAGE_URI" \
  --push \
  .

SA_NAME="${SERVICE_NAME}-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if [ "$SETUP" = true ]; then
  echo "== [SETUP] Service Account dedicada =="
  if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA_NAME" \
      --display-name="Cloud Run SA - ${SERVICE_NAME}" >/dev/null
  fi

  echo "== [SETUP] Permissões Firestore (IAM) para a SA =="
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/datastore.user" \
    --quiet >/dev/null
fi

echo "== Deploy Cloud Run =="
# Se as senhas foram passadas via flag, atualizamos as env vars (literal).
# Caso contrário, o Cloud Run manterá as configurações atuais (ex: Secret Manager).
EXTRA_FLAGS=""
ENV_VARS=""

if [[ -n "$ADMIN_PASSWORD" ]]; then
  ENV_VARS="ADMIN_PASSWORD=${ADMIN_PASSWORD}"
fi
if [[ -n "$ADMIN_JWT_SECRET" ]]; then
  if [[ -n "$ENV_VARS" ]]; then ENV_VARS="${ENV_VARS},"; fi
  ENV_VARS="${ENV_VARS}ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}"
fi
if [[ -n "$WEB_ORIGIN" ]]; then
  if [[ -n "$ENV_VARS" ]]; then ENV_VARS="${ENV_VARS},"; fi
  ENV_VARS="${ENV_VARS}WEB_ORIGIN=${WEB_ORIGIN}"
fi

if [[ -n "$ENV_VARS" ]]; then
  EXTRA_FLAGS="--update-env-vars=$ENV_VARS"
fi

gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_URI" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$SA_EMAIL" \
  --allow-unauthenticated \
  $EXTRA_FLAGS \
  --quiet

echo "== URL do serviço =="
gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --format="value(status.url)"

echo ""
echo "✅ Deploy concluído."