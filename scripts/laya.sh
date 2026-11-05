#!/usr/bin/env bash
set -euo pipefail
cogniva_local="${COGNIVA_LOCAL_DIR:-$HOME/.local/share/cogniva}"
mkdir -p "$cogniva_local"
if [[ ! -x "$cogniva_local/laya-venv/bin/laya-serve" ]]; then
  uv venv --python 3.13 "$cogniva_local/laya-venv"
  uv pip install --python "$cogniva_local/laya-venv/bin/python" 'laya[serve]==0.4.24'
fi
export HF_HOME="$cogniva_local/huggingface"
export HF_HUB_DISABLE_IMPLICIT_TOKEN=1
export LAYA_HOST=127.0.0.1
export LAYA_PORT="${LAYA_PORT:-8000}"
export LAYA_MODELS=english
export LAYA_DEFAULT_MODEL=english
export LAYA_DEVICE="${LAYA_DEVICE:-cpu}"
export LAYA_THREADS="${LAYA_THREADS:-4}"
exec "$cogniva_local/laya-venv/bin/laya-serve"
