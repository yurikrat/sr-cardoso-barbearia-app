#!/bin/bash

# Script simples para obter configuração do Firebase
# Requer: firebase login --reauth já executado

PROJECT_ID="sr-cardoso-barbearia-prd"

echo "🔍 Obtendo configuração do Firebase para: $PROJECT_ID"
echo ""

# Verificar autenticação
if ! firebase projects:list &>/dev/null; then
  echo "❌ Execute primeiro: firebase login --reauth"
  exit 1
fi

# Configurar projeto
firebase use $PROJECT_ID 2>/dev/null || {
  echo "❌ Projeto $PROJECT_ID não encontrado ou sem acesso"
  exit 1
}

# Tentar obter config
echo "📱 Tentando obter configuração do app web..."
CONFIG=$(firebase apps:sdkconfig WEB --project $PROJECT_ID 2>/dev/null || echo "")

if [ -z "$CONFIG" ]; then
  echo ""
  echo "⚠️  App web não encontrado ou não foi possível obter config."
  echo ""
  echo "📋 Crie o app web manualmente:"
  echo "   1. Acesse: https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
  echo "   2. Clique em 'Add app' > Web (</>)"
  echo "   3. Dê um nome (ex: 'sr-cardoso-web') e registre"
  echo "   4. Copie o firebaseConfig que aparece"
  echo "   5. Execute este script novamente OU crie apps/web/.env manualmente"
  echo ""
  exit 0
fi

# Mostrar config
echo "✅ Configuração obtida:"
echo ""
echo "$CONFIG"
echo ""
echo "💡 Para usar no .env, extraia os valores do firebaseConfig acima"
echo "   ou execute: ./scripts/setup-firebase-cli.sh (tenta criar .env automaticamente)"

