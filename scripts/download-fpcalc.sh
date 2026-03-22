#!/bin/bash
# scripts/download-fpcalc.sh
set -e
CHROMAPRINT_VERSION="1.5.1"
PLATFORM="$(uname -m)"
mkdir -p vendor/fpcalc

if [ "$PLATFORM" = "arm64" ]; then
  if command -v brew &> /dev/null; then
    FPCALC_PATH="$(brew --prefix chromaprint 2>/dev/null)/bin/fpcalc" || true
    if [ -f "$FPCALC_PATH" ]; then
      cp "$FPCALC_PATH" vendor/fpcalc/fpcalc
      echo "Copied fpcalc from Homebrew"
    else
      echo "Installing chromaprint via Homebrew..."
      brew install chromaprint
      cp "$(brew --prefix chromaprint)/bin/fpcalc" vendor/fpcalc/fpcalc
    fi
    # Copy libchromaprint dylib so fpcalc works outside Homebrew prefix
    CHROMAPRINT_LIB="$(brew --prefix chromaprint)/lib/libchromaprint.1.dylib"
    if [ -f "$CHROMAPRINT_LIB" ]; then
      cp "$CHROMAPRINT_LIB" vendor/fpcalc/libchromaprint.1.dylib
      # Fix rpath so fpcalc finds libchromaprint next to itself
      install_name_tool -add_rpath "@loader_path" vendor/fpcalc/fpcalc 2>/dev/null || true
      # Re-sign with ad-hoc signature after binary modification
      codesign --force --sign - vendor/fpcalc/fpcalc
      echo "Bundled libchromaprint.1.dylib and re-signed fpcalc"
    fi
  fi
fi

chmod +x vendor/fpcalc/fpcalc
echo "fpcalc ready at vendor/fpcalc/fpcalc"
