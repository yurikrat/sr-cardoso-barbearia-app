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
#     --service sr-cardoso-barbearia \
#     --admin-password 'SENHA_FORTE' \
#     --admin-jwt-secret 'SEGREDO_LONGO'
#
# Opcional:
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
    -h|--help) sed -n '1,120p' "$0"; exit 0 ;;
    *) die "flag desconhecida: $1" ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || die "--project é obrigatório"
[[ -n "$ADMIN_PASSWORD" ]] || die "--admin-password é obrigatório"
[[ -n "$ADMIN_JWT_SECRET" ]] || die "--admin-jwt-secret é obrigatório"

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

echo "== Habilitando APIs necessárias (idempotente) =="
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  >/dev/null

echo "== Garantindo Artifact Registry repo (idempotente) =="
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Sr Cardoso - Docker images" >/dev/null
fi

echo "== Configurando docker auth para Artifact Registry =="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "== Build do monorepo (web + server) =="
npm run build:web >/dev/null
npm run build:server >/dev/null

echo "== Docker build (local) =="
docker build -f apps/server/Dockerfile -t "$IMAGE_URI" .

echo "== Docker push =="
docker push "$IMAGE_URI" >/dev/null

echo "== Service Account dedicada (idempotente) =="
SA_NAME="${SERVICE_NAME}-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Cloud Run SA - ${SERVICE_NAME}" >/dev/null
fi

echo "== Permissões Firestore (IAM) para a SA (idempotente) =="
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user" \
  --quiet >/dev/null

echo "== Deploy Cloud Run =="
ENV_VARS="ADMIN_PASSWORD=${ADMIN_PASSWORD},ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}"
if [[ -n "$WEB_ORIGIN" ]]; then
  ENV_VARS="${ENV_VARS},WEB_ORIGIN=${WEB_ORIGIN}"
fi

gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_URI" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$SA_EMAIL" \
  --allow-unauthenticated \
  --set-env-vars="$ENV_VARS" \
  --quiet

echo "== URL do serviço =="
gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --format="value(status.url)"

echo ""
echo "✅ Deploy concluído."
echo ""
echo "⚠️  Primeira vez: você ainda precisa garantir os ÍNDICES do Firestore para as queries (veja README)."


