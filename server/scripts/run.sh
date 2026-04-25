#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

CONFIG_PATH="${ROOT_DIR}/server/config.yaml"
CIRCUIT_PATH="${TMPDIR:-/tmp}/qsim-circuit.yaml"

node "${ROOT_DIR}/server/scripts/convert-config-to-qsim.js" "${CONFIG_PATH}" "${CIRCUIT_PATH}"

if command -v make >/dev/null 2>&1; then
  make -C "${ROOT_DIR}/c" all >/dev/null
elif command -v nix-shell >/dev/null 2>&1; then
  nix-shell "${ROOT_DIR}/shell.nix" --run "make -C c all" >/dev/null
else
  echo "error: build tools not found (need 'make' or 'nix-shell')" >&2
  exit 127
fi

QSIM_BIN="${ROOT_DIR}/c/build/bin/qsim"
if [[ "${QSIM_STEPS:-}" == "1" ]]; then
  exec "${QSIM_BIN}" "${CIRCUIT_PATH}" --steps
else
  exec "${QSIM_BIN}" "${CIRCUIT_PATH}"
fi
