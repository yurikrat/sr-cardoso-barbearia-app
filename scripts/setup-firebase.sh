#!/bin/bash

# Script para configurar Firebase no projeto sr-cardoso-barbearia-prd
# Execute após fazer: gcloud auth login e firebase login --reauth

set -e

PROJECT_ID="sr-cardoso-barbearia-prd"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")

echo "🚀 Configurando Firebase para projeto: $PROJECT_ID"
echo "📊 Project Number: $PROJECT_NUMBER"
echo ""

# 1. Configurar projeto no gcloud
echo "1️⃣ Configurando projeto no gcloud..."
gcloud config set project $PROJECT_ID

# 2. Habilitar APIs necessárias
echo "2️⃣ Habilitando APIs do Firebase..."
gcloud services enable firebase.googleapis.com
gcloud services enable firestore.googleapis.com
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# 3. Verificar se Firebase já está inicializado
echo "3️⃣ Verificando se Firebase está inicializado..."
if ! firebase projects:list | grep -q "$PROJECT_ID"; then
  echo "⚠️  Projeto não encontrado no Firebase. Inicializando..."
  firebase init --project $PROJECT_ID --non-interactive || {
    echo "❌ Erro ao inicializar Firebase. Execute manualmente:"
    echo "   firebase init"
    exit 1
  }
fi

# 4. Usar projeto no Firebase CLI
echo "4️⃣ Configurando Firebase CLI para usar projeto..."
firebase use $PROJECT_ID

# 5. Verificar se app web já existe
echo "5️⃣ Verificando apps web existentes..."
WEB_APPS=$(firebase apps:list WEB --project $PROJECT_ID --json 2>/dev/null || echo "[]")

if [ "$WEB_APPS" = "[]" ] || [ -z "$WEB_APPS" ]; then
  echo "📱 Criando app web no Firebase..."
  APP_NAME="sr-cardoso-web"
  firebase apps:create WEB "$APP_NAME" --project $PROJECT_ID || {
    echo "⚠️  Não foi possível criar app via CLI. Crie manualmente no Console:"
    echo "   https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
    echo ""
    echo "   Depois, execute este script novamente para obter as credenciais."
    exit 1
  }
else
  echo "✅ App web já existe"
fi

# 6. Obter configuração do app web
echo "6️⃣ Obtendo configuração do Firebase..."
CONFIG=$(firebase apps:sdkconfig WEB --project $PROJECT_ID 2>/dev/null || echo "")

if [ -z "$CONFIG" ]; then
  echo "⚠️  Não foi possível obter config via CLI."
  echo "📋 Siga estes passos:"
  echo "   1. Acesse: https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
  echo "   2. Na seção 'Your apps', clique no app web (ou crie um novo)"
  echo "   3. Copie o firebaseConfig"
  echo "   4. Crie o arquivo apps/web/.env com:"
  echo ""
  echo "   VITE_FIREBASE_API_KEY=<apiKey>"
  echo "   VITE_FIREBASE_AUTH_DOMAIN=<authDomain>"
  echo "   VITE_FIREBASE_PROJECT_ID=$PROJECT_ID"
  echo "   VITE_FIREBASE_STORAGE_BUCKET=$PROJECT_ID.appspot.com"
  echo "   VITE_FIREBASE_MESSAGING_SENDER_ID=<messagingSenderId>"
  echo "   VITE_FIREBASE_APP_ID=<appId>"
  exit 0
fi

# 7. Extrair valores do firebaseConfig (se retornado em formato JSON)
echo "7️⃣ Extraindo credenciais..."
# O Firebase CLI pode retornar em diferentes formatos, vamos tentar extrair

# Tentar extrair do JSON se possível
API_KEY=$(echo "$CONFIG" | grep -oP '"apiKey":\s*"\K[^"]+' || echo "")
AUTH_DOMAIN=$(echo "$CONFIG" | grep -oP '"authDomain":\s*"\K[^"]+' || echo "$PROJECT_ID.firebaseapp.com")
STORAGE_BUCKET=$(echo "$CONFIG" | grep -oP '"storageBucket":\s*"\K[^"]+' || echo "$PROJECT_ID.appspot.com")
MESSAGING_SENDER_ID=$(echo "$CONFIG" | grep -oP '"messagingSenderId":\s*"\K[^"]+' || echo "")
APP_ID=$(echo "$CONFIG" | grep -oP '"appId":\s*"\K[^"]+' || echo "")

# Se não conseguiu extrair, usar valores padrão baseados no projeto
if [ -z "$API_KEY" ]; then
  echo "⚠️  Não foi possível extrair todas as credenciais automaticamente."
  echo "📋 Acesse o Firebase Console e copie o firebaseConfig:"
  echo "   https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
  echo ""
  echo "   Crie apps/web/.env com os valores do firebaseConfig"
  exit 0
fi

# 8. Criar arquivo .env
echo "8️⃣ Criando arquivo apps/web/.env..."
mkdir -p apps/web

cat > apps/web/.env <<EOF
# Firebase Configuration
# Gerado automaticamente por scripts/setup-firebase.sh
VITE_FIREBASE_API_KEY=$API_KEY
VITE_FIREBASE_AUTH_DOMAIN=$AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID=$PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=$STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID=$MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID=$APP_ID
EOF

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "📝 Arquivo apps/web/.env criado com sucesso."
echo ""
echo "🔍 Verifique se todas as variáveis estão corretas:"
echo "   cat apps/web/.env"
echo ""
echo "🚀 Próximos passos:"
echo "   1. Configure Firebase Auth (Email/Password) no Console"
echo "   2. Deploy das regras do Firestore:"
echo "      firebase deploy --only firestore:rules,firestore:indexes"
echo "   3. Inicialize os barbeiros:"
echo "      npx tsx scripts/init-barbers.ts"
echo ""

