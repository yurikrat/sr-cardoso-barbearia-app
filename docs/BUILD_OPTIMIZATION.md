# Otimização de Build - Sr. Cardoso Barbearia

Este documento descreve estratégias para acelerar o processo de build e deploy do projeto.

## Análise do Estado Atual

### O que já está bom ✅

1. **Multi-stage builds**: O Dockerfile já utiliza stages separados (`base`, `build-shared`, `build-web`, `build-server`, final)
2. **Cache de npm**: Uso de `--mount=type=cache,target=/app/.npm` para persistir cache npm entre builds
3. **Remote cache**: O script de deploy já usa `--cache-from` e `--cache-to` para registry cache
4. **Ordem de layers**: `package.json` é copiado antes do código fonte
5. **`.dockerignore`**: Exclui `node_modules`, `dist`, `.git`, etc.

### Gargalos Identificados 🔍

1. **Redundância de builds**: O script faz `npm -w apps/web run build` e `npm -w apps/server run build` **antes** do Docker build, e o Dockerfile faz tudo de novo
2. **Sem paralelismo real**: Apesar de ter stages separados, `build-web` e `build-server` dependem de `build-shared` sequencialmente
3. **Sem TypeScript incremental**: Não usa `tsc --build` ou project references
4. **Cache de Vite não otimizado**: O `--mount=type=cache,target=/app/apps/web/node_modules/.vite` pode não estar funcionando corretamente

---

## Otimizações Recomendadas

### 1. Eliminar Builds Redundantes (Impacto: ALTO) 🚀

O maior ganho imediato é não fazer o build duas vezes. Atualmente o script faz:

```bash
# Preflight (build local)
npm -w apps/web run lint
npm -w apps/web run build      # ~60-90s
npm -w apps/server run build   # ~10-20s

# Docker build (build no container)
# ... rebuild tudo dentro do Docker
```

**Solução A (Preferida): Remover preflight build**

O preflight build só faz sentido como "sanity check". Se o CI já faz isso, pode remover:

```bash
# Em deploy-cloudrun.sh, substituir:
echo "== Preflight checks (lint + build) =="
npm -w apps/web run lint
npm -w apps/web run build
npm -w apps/server run build

# Por:
echo "== Preflight checks (lint apenas) =="
npm -w apps/web run lint
```

Isso economiza **60-100 segundos** por deploy.

**Solução B (Alternativa): Copiar artifacts locais**

Se preferir manter o build local, pode copiar os artifacts prontos em vez de rebuildar no Docker:

```dockerfile
# Novo Dockerfile.copy-artifacts
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Copiar apenas os artifacts já buildados localmente
COPY package.json package-lock.json ./
COPY packages/shared/dist ./packages/shared/dist
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/dist ./apps/server/dist
COPY apps/server/package.json ./apps/server/
COPY apps/web/dist ./apps/web/dist

# Instalar apenas production deps
RUN npm ci --omit=dev --no-audit --no-fund

WORKDIR /app/apps/server
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

---

### 2. TypeScript Project References (Impacto: MÉDIO) 📚

Usar `tsc --build` com project references permite builds incrementais e cache de `.d.ts`:

**a) Atualizar `packages/shared/tsconfig.json`:**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "composite": true,          // IMPORTANTE: habilita project references
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**b) Atualizar `apps/server/tsconfig.json`:**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "composite": true,
    "declaration": true
  },
  "references": [
    { "path": "../../packages/shared" }
  ],
  "include": ["src"]
}
```

**c) Criar `tsconfig.build.json` na raiz:**

```jsonc
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "apps/server" }
  ]
}
```

**d) Usar `tsc --build`:**

```bash
# Em vez de:
npm run build --workspace=packages/shared
npm run build --workspace=apps/server

# Usar:
tsc --build tsconfig.build.json
# Ou para incremental:
tsc --build tsconfig.build.json --incremental
```

---

### 3. Otimizar Vite Build (Impacto: MÉDIO) ⚡

**a) Desativar sourcemaps em produção:**

```typescript
// apps/web/vite.config.ts
export default defineConfig({
  build: {
    sourcemap: false,  // Economiza tempo e espaço
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'radix': ['@radix-ui/react-dialog', '@radix-ui/react-tabs', /* ... */],
          'query': ['@tanstack/react-query'],
        }
      }
    }
  },
  // ... resto da config
})
```

**b) Usar esbuild minifier (padrão, mas verificar):**

Vite já usa esbuild por padrão, que é muito rápido. Certifique-se de não ter alterado:

```typescript
build: {
  minify: 'esbuild',  // padrão, não mudar para 'terser'
}
```

**c) Considerar usar SWC para React:**

```bash
npm install -D @vitejs/plugin-react-swc
```

```typescript
// apps/web/vite.config.ts
import react from '@vitejs/plugin-react-swc';  // Em vez de @vitejs/plugin-react
```

SWC é ~20x mais rápido que Babel para transformações React.

---

### 4. Melhorar Cache do Docker (Impacto: MÉDIO) 🐳

**a) Atualizar .dockerignore:**

```ignore
# Arquivos de desenvolvimento que nunca são necessários no container
node_modules
**/node_modules
dist
**/dist
*.tsbuildinfo
**/*.tsbuildinfo
.git
.vscode
.cursor
.github
.codex
docs
skills-packages
scripts
firebase
*.log
.env*
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.DS_Store
*.md
!packages/shared/src
!apps/server/src
!apps/web/src
```

**b) Usar inline cache (mais eficiente para CI):**

```bash
# Em deploy-cloudrun.sh, considerar:
BUILD_CACHE_FLAGS="--cache-from=type=registry,ref=${CACHE_REF}"
if [[ "$USE_CACHE_TO" = true ]]; then
  BUILD_CACHE_FLAGS="${BUILD_CACHE_FLAGS} --cache-to=type=inline"  # inline é mais rápido
fi
```

**c) Separar dependencies e devDependencies:**

```dockerfile
# Stage para prod dependencies apenas
FROM base AS deps-prod
RUN npm ci --omit=dev --no-audit --no-fund

# Final stage usa deps-prod ao invés de fazer prune
FROM node:20-bookworm-slim AS final
COPY --from=deps-prod /app/node_modules ./node_modules
# ... não precisa fazer npm prune
```

---

### 5. Docker Build Cloud (Impacto: MUITO ALTO se aplicável) ☁️

Docker Build Cloud oferece builders remotos com cache persistente e hardware otimizado:

```bash
# Uma vez configurado:
docker buildx build \
  --builder cloud-username-buildername \
  --platform linux/amd64 \
  -t "$IMAGE_URI" \
  --push \
  .
```

Benefícios:
- Cache persistente sem configuração
- Hardware otimizado para builds
- Não consome recursos da máquina local
- Potencialmente 2-5x mais rápido

Custo: $5/mês para uso básico, mas pode valer para deploys frequentes.

---

## Plano de Implementação Recomendado

### Fase 1: Quick Wins (hoje) ⚡
1. Remover build redundante no script de deploy
2. Adicionar itens extras ao `.dockerignore`

**Economia estimada: 60-100 segundos**

### Fase 2: TypeScript Optimization (próxima semana) 📚
1. Habilitar `composite` e project references
2. Usar `tsc --build` com incremental

**Economia estimada: 10-30 segundos (mais em builds incrementais)**

### Fase 3: Vite Optimization (próxima semana) ⚡
1. Configurar manualChunks
2. Migrar para @vitejs/plugin-react-swc
3. Desabilitar sourcemaps em produção

**Economia estimada: 10-20 segundos**

### Fase 4: Arquitetura (futuro) 🏗️
1. Avaliar Docker Build Cloud
2. Considerar GitHub Actions com cache nativo

---

## Métricas para Acompanhar

Antes de implementar, registre os tempos atuais:

```bash
# Build completo
time ./scripts/deploy-cloudrun.sh --project sr-cardoso-barbearia-prd

# Apenas Docker build (sem deploy)
time docker buildx build --platform linux/amd64 -f apps/server/Dockerfile .

# Apenas Vite build
time npm -w apps/web run build

# Apenas TypeScript
time npm -w packages/shared run build
time npm -w apps/server run build
```

**Meta**: Reduzir tempo total de deploy de ~200s para ~90-120s.

---

## Referências

- [Docker Build Cache Optimization](https://docs.docker.com/build/cache/optimize/)
- [Docker Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Vite Performance Guide](https://vite.dev/guide/performance)
- [Vite Build Optimization](https://vite.dev/guide/build)
