#!/usr/bin/env bash
set -euo pipefail

# Repo Hygiene (report-only)
# - Não altera nada
# - Apenas lista itens suspeitos de "poluição" para revisão humana

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== Repo hygiene report (report-only) =="
echo "Root: $ROOT"
echo

echo "## 1) Suspeitos por nome (temp/draft/backup/etc)"
find . \
  -path './node_modules' -prune -o \
  -path './apps/**/node_modules' -prune -o \
  -path './packages/**/node_modules' -prune -o \
  -path './dist' -prune -o \
  -path './build' -prune -o \
  -path './.git' -prune -o \
  -type f \
  \( -iname '*tmp*' -o -iname '*temp*' -o -iname '*draft*' -o -iname '*.bak*' -o -iname '*backup*' -o -iname '*copy*' -o -iname '*old*' \) \
  -print \
  | sed 's|^\./||' \
  | sort || true
echo

echo "## 2) Logs e artefatos comuns (devem ficar ignorados)"
find . \
  -path './node_modules' -prune -o \
  -path './apps/**/node_modules' -prune -o \
  -path './packages/**/node_modules' -prune -o \
  -path './dist' -prune -o \
  -path './build' -prune -o \
  -path './.git' -prune -o \
  -type f \
  \( -name '*.log' -o -name '*.tsbuildinfo' -o -name '*~' \) \
  -print \
  | sed 's|^\./||' \
  | sort || true
echo

echo "## 3) Untracked (git) — atenção: pode indicar arquivos gerados/local"
if command -v git >/dev/null 2>&1; then
  git status --porcelain | sed 's/^/ - /' || true
else
  echo "git não encontrado"
fi
echo

echo "== Fim =="

