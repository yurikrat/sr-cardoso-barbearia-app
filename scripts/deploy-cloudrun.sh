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

DEFAULT_PROJECT_ID="sr-cardoso-barbearia-prd"
DEFAULT_REGION="us-central1"
DEFAULT_SERVICE_NAME="sr-cardoso-barbearia"

PROJECT_ID=""
REGION="$DEFAULT_REGION"
SERVICE_NAME="$DEFAULT_SERVICE_NAME"
AR_REPO="sr-cardoso"
IMAGE_TAG=""
USE_REMOTE_CACHE=true
USE_CACHE_TO=true
BUILDER_NAME="sr-cardoso-builder"
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
    --no-cache) USE_REMOTE_CACHE=false; shift ;;
    --cache-import-only) USE_CACHE_TO=false; shift ;;
    --builder) BUILDER_NAME="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --admin-jwt-secret) ADMIN_JWT_SECRET="${2:-}"; shift 2 ;;
    --web-origin) WEB_ORIGIN="${2:-}"; shift 2 ;;
    --setup) SETUP=true; shift ;;
    -h|--help) sed -n '1,120p' "$0"; exit 0 ;;
    *) die "flag desconhecida: $1" ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  # Prefer current gcloud config if set; otherwise use the repo default.
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
  PROJECT_ID="${PROJECT_ID:-$DEFAULT_PROJECT_ID}"
fi

if [[ -z "$REGION" ]]; then
  REGION="$DEFAULT_REGION"
fi

if [[ -z "$SERVICE_NAME" ]]; then
  SERVICE_NAME="$DEFAULT_SERVICE_NAME"
fi

[[ -n "$PROJECT_ID" ]] || die "Não foi possível determinar o project (use --project)"

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
if [[ "$USE_REMOTE_CACHE" = true ]]; then
  echo "Cache  : remote (registry) $([[ "$USE_CACHE_TO" = true ]] && echo 'import+export' || echo 'import-only')"
else
  echo "Cache  : disabled"
fi
echo "Builder: $BUILDER_NAME"

command -v gcloud >/dev/null 2>&1 || die "gcloud não encontrado"
command -v docker >/dev/null 2>&1 || die "docker não encontrado"
command -v npm >/dev/null 2>&1 || die "npm não encontrado"

# Docker daemon precisa estar rodando (Docker Desktop, Colima, etc.)
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon não está acessível. Inicie um daemon Docker (ex: Colima ou Docker Desktop) e tente novamente."
fi

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
CACHE_REF="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:buildcache"

echo "== Preflight checks (lint) =="
echo "== (web) lint =="
npm -w apps/web run lint

echo "== (server) lint =="
# Se houver lint no server, rodar aqui. Se não, apenas pular para o docker build.

echo "== Build do monorepo (via Docker multi-stage) =="
# Observação: Removemos build local redundante. O Dockerfile já builda tudo.

echo "== Docker build (local) =="
if ! docker buildx version >/dev/null 2>&1; then
  die "docker buildx não está disponível. Atualize o Docker Desktop."
fi

# Cloud Run exige linux/amd64. Em Macs ARM, o build padrão gera arm64 e falha no deploy.
echo "== Docker buildx (linux/amd64) + push =="
# Garante que existe um builder ativo
if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER_NAME" --use >/dev/null
else
  docker buildx use "$BUILDER_NAME" >/dev/null
fi

# --provenance=false evita gerar manifest list/attestations que podem confundir alguns runtimes
BUILD_CACHE_FLAGS=""
if [[ "$USE_REMOTE_CACHE" = true ]]; then
  BUILD_CACHE_FLAGS="--cache-from=type=registry,ref=${CACHE_REF}"
  if [[ "$USE_CACHE_TO" = true ]]; then
    BUILD_CACHE_FLAGS="${BUILD_CACHE_FLAGS} --cache-to=type=registry,ref=${CACHE_REF},mode=max"
  fi
fi

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  -f apps/server/Dockerfile \
  -t "$IMAGE_URI" \
  $BUILD_CACHE_FLAGS \
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
  --vpc-connector=evolution-connector \
  --vpc-egress=private-ranges-only \
  $EXTRA_FLAGS \
  --quiet

echo "== URL do serviço =="
gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --format="value(status.url)"

echo ""
echo "✅ Deploy concluído."