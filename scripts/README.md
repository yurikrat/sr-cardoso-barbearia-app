# Scripts

## Ativos

### `init-barbers.ts`
Inicializa os barbeiros no Firestore com tokens de calendário.

**Uso:**
```bash
export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
npx tsx scripts/init-barbers.ts
```

### `deploy-cloudrun.sh`
Deploy do backend no Cloud Run (build local + push + deploy).

**Uso:**
```bash
./scripts/deploy-cloudrun.sh \
  --project sr-cardoso-barbearia-prd \
  --region us-central1 \
  --service sr-cardoso-api \
  --admin-password 'seu-password' \
  --admin-jwt-secret 'seu-secret'
```

**Dica de performance (deploy mais rápido):**

Se o seu deploy está demorando muito na etapa de "exporting cache to registry" (cache-to), você pode usar cache **apenas para leitura**:

```bash
./scripts/deploy-cloudrun.sh \
  --project sr-cardoso-barbearia-prd \
  --region us-central1 \
  --service sr-cardoso-barbearia \
  --cache-import-only
```

Isso mantém o `--cache-from` (aproveita o cache existente), mas evita o custo de fazer push do cache a cada deploy.

## Obsoletos

Os seguintes scripts são obsoletos (projeto migrou de Firebase para Cloud Run):
- `setup-firebase.sh.obsolete`
- `get-firebase-config.sh.obsolete`
- `setup-firebase-cli.sh.obsolete`

Mantidos apenas para referência histórica.
