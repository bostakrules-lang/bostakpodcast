#!/usr/bin/env bash
# Setup script para el environment cloud de la Claude Code Routine.
# Se ejecuta UNA vez y queda cacheado. Instala todo lo que el pipeline necesita.
set -e

echo "==> Updating apt"
sudo apt-get update -y

echo "==> Installing system deps: ffmpeg, python3-pip"
sudo apt-get install -y ffmpeg python3-pip

echo "==> ffmpeg version: $(ffmpeg -version | head -1)"
echo "==> node version: $(node --version)"
echo "==> python3 version: $(python3 --version)"

echo "==> Installing Python deps for reel-factory"
pip3 install --user opencv-python-headless numpy pillow

echo "==> Installing node deps in reel-factory"
cd "$(dirname "$0")/.."
# Asumimos que package.json está en la raíz del repo
npm ci --prefer-offline --no-audit --no-fund

echo "==> Pre-downloading Remotion compositor (evita descargas en el primer render)"
node -e "import('@remotion/renderer').then(m => m.getCompositor?.())" 2>/dev/null || true

echo "==> Setup done."
