#!/usr/bin/env bash
# Setup script para el environment cloud de la Claude Code Routine.
# Se ejecuta UNA vez y queda cacheado. Instala todo lo que el pipeline necesita.
#
# Clona el repo público reel-factory (bostakrules-lang/bostakpodcast) en ~/reel-factory
# y deja ese directorio como CWD para el prompt.
set -e

REPO_URL="https://github.com/bostakrules-lang/bostakpodcast.git"
REPO_DIR="$HOME/reel-factory"

echo "==> Updating apt"
sudo apt-get update -y

echo "==> Installing system deps: ffmpeg, python3-pip, git"
sudo apt-get install -y ffmpeg python3-pip git

echo "==> ffmpeg version: $(ffmpeg -version | head -1)"
echo "==> node version: $(node --version)"
echo "==> python3 version: $(python3 --version)"

echo "==> Cloning reel-factory from $REPO_URL"
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR" && git pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

echo "==> Installing Python deps for reel-factory"
pip3 install --user opencv-python-headless numpy pillow

echo "==> Installing node deps in reel-factory"
npm ci --prefer-offline --no-audit --no-fund

echo "==> Pre-downloading Remotion compositor (evita descargas en el primer render)"
node -e "import('@remotion/renderer').then(m => m.getCompositor?.())" 2>/dev/null || true

echo "==> Setup done. reel-factory ready at $REPO_DIR"
