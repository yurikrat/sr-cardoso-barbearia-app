#!/bin/bash

# Script alternativo usando apenas Firebase CLI
# Execute após: firebase login --reauth

set -e

PROJECT_ID="sr-cardoso-barbearia-prd"

echo "🚀 Configurando Firebase via CLI para: $PROJECT_ID"
echo ""

# 1. Verificar autenticação
echo "1️⃣ Verificando autenticação Firebase..."
if ! firebase projects:list &>/dev/null; then
  echo "❌ Não autenticado. Execute: firebase login --reauth"
  exit 1
fi

# 2. Verificar se projeto existe
echo "2️⃣ Verificando se projeto existe..."
if ! firebase projects:list | grep -q "$PROJECT_ID"; then
  echo "❌ Projeto $PROJECT_ID não encontrado na sua conta Firebase."
  echo "   Verifique se você tem acesso ao projeto."
  exit 1
fi

# 3. Usar projeto
echo "3️⃣ Configurando projeto no Firebase CLI..."
firebase use $PROJECT_ID

# 4. Listar apps existentes
echo "4️⃣ Verificando apps web existentes..."
WEB_APP_ID=$(firebase apps:list WEB --project $PROJECT_ID --json 2>/dev/null | jq -r '.[0].appId' 2>/dev/null || echo "")

if [ -z "$WEB_APP_ID" ] || [ "$WEB_APP_ID" = "null" ]; then
  echo "📱 Criando app web..."
  firebase apps:create WEB "sr-cardoso-web" --project $PROJECT_ID
  echo "✅ App web criado!"
  # Aguardar um pouco para o app ser propagado
  sleep 3
else
  echo "✅ App web já existe: $WEB_APP_ID"
fi

# 5. Obter configuração
echo "5️⃣ Obtendo configuração do Firebase..."
CONFIG_JSON=$(firebase apps:sdkconfig WEB --project $PROJECT_ID --json 2>/dev/null || echo "")

if [ -z "$CONFIG_JSON" ]; then
  echo ""
  echo "⚠️  Não foi possível obter config automaticamente."
  echo ""
  echo "📋 Siga estes passos manuais:"
  echo "   1. Acesse: https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
  echo "   2. Na seção 'Your apps', encontre o app web"
  echo "   3. Clique em 'Config' para ver o firebaseConfig"
  echo "   4. Crie o arquivo apps/web/.env com:"
  echo ""
  echo "   VITE_FIREBASE_API_KEY=<apiKey do firebaseConfig>"
  echo "   VITE_FIREBASE_AUTH_DOMAIN=<authDomain do firebaseConfig>"
  echo "   VITE_FIREBASE_PROJECT_ID=$PROJECT_ID"
  echo "   VITE_FIREBASE_STORAGE_BUCKET=$PROJECT_ID.appspot.com"
  echo "   VITE_FIREBASE_MESSAGING_SENDER_ID=<messagingSenderId do firebaseConfig>"
  echo "   VITE_FIREBASE_APP_ID=<appId do firebaseConfig>"
  echo ""
  exit 0
fi

# 6. Extrair valores usando jq (se disponível) ou grep
echo "6️⃣ Extraindo credenciais..."

if command -v jq &> /dev/null; then
  API_KEY=$(echo "$CONFIG_JSON" | jq -r '.apiKey // empty' 2>/dev/null || echo "")
  AUTH_DOMAIN=$(echo "$CONFIG_JSON" | jq -r '.authDomain // empty' 2>/dev/null || echo "$PROJECT_ID.firebaseapp.com")
  STORAGE_BUCKET=$(echo "$CONFIG_JSON" | jq -r '.storageBucket // empty' 2>/dev/null || echo "$PROJECT_ID.appspot.com")
  MESSAGING_SENDER_ID=$(echo "$CONFIG_JSON" | jq -r '.messagingSenderId // empty' 2>/dev/null || echo "")
  APP_ID=$(echo "$CONFIG_JSON" | jq -r '.appId // empty' 2>/dev/null || echo "")
else
  # Fallback: tentar extrair com grep/sed
  API_KEY=$(echo "$CONFIG_JSON" | grep -oP '"apiKey":\s*"\K[^"]+' | head -1 || echo "")
  AUTH_DOMAIN=$(echo "$CONFIG_JSON" | grep -oP '"authDomain":\s*"\K[^"]+' | head -1 || echo "$PROJECT_ID.firebaseapp.com")
  STORAGE_BUCKET=$(echo "$CONFIG_JSON" | grep -oP '"storageBucket":\s*"\K[^"]+' | head -1 || echo "$PROJECT_ID.appspot.com")
  MESSAGING_SENDER_ID=$(echo "$CONFIG_JSON" | grep -oP '"messagingSenderId":\s*"\K[^"]+' | head -1 || echo "")
  APP_ID=$(echo "$CONFIG_JSON" | grep -oP '"appId":\s*"\K[^"]+' | head -1 || echo "")
fi

# 7. Validar se temos valores essenciais
if [ -z "$API_KEY" ] || [ -z "$APP_ID" ]; then
  echo ""
  echo "⚠️  Não foi possível extrair todas as credenciais."
  echo "   O Firebase CLI pode ter retornado em formato diferente."
  echo ""
  echo "📋 Acesse manualmente:"
  echo "   https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
  echo ""
  echo "   E crie apps/web/.env com os valores do firebaseConfig"
  exit 0
fi

# 8. Criar .env
echo "7️⃣ Criando apps/web/.env..."
mkdir -p apps/web

cat > apps/web/.env <<EOF
# Firebase Configuration
# Gerado automaticamente por scripts/setup-firebase-cli.sh
# Projeto: $PROJECT_ID
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
echo "📝 Arquivo apps/web/.env criado:"
echo "   $(pwd)/apps/web/.env"
echo ""
echo "🔍 Verifique o conteúdo:"
echo "   cat apps/web/.env"
echo ""
echo "🚀 Próximos passos:"
echo "   1. Configure Firebase Auth (Email/Password) no Console:"
echo "      https://console.firebase.google.com/project/$PROJECT_ID/authentication/users"
echo ""
echo "   2. Deploy das regras do Firestore:"
echo "      firebase deploy --only firestore:rules,firestore:indexes"
echo ""
echo "   3. Inicialize os barbeiros:"
echo "      export FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json"
echo "      npx tsx scripts/init-barbers.ts"
echo ""

