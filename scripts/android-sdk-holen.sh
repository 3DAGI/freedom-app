#!/usr/bin/env bash
# Android-SDK für den Motor (VKh2b, `docs/ANDROID-ENTWURF.md`, VKh-W1 C): die Kommandozeilen-Werkzeuge von Google in fester
# Fassung, gegen SHA-256 geprüft (die Summe steht auf developer.android.com/studio, hier fest), dann über deren sdkmanager genau
# eine Plattform und eine Fassung der Build-Tools – sdkmanager prüft deren Summen aus der Liste von Google selbst.
#
# Das SDK steht unter dem Lizenzvertrag von Google (https://developer.android.com/studio/terms), nicht unter einer freien
# Lizenz. Annehmen kann ihn nur, wer das Bild baut – mit ANDROID_SDK_LIZENZ=angenommen. Ohne das bricht das Skript ab, bevor
# es etwas lädt. Ein Bild mit SDK darf man nicht weitergeben.
#
#   ANDROID_SDK_LIZENZ=angenommen scripts/android-sdk-holen.sh <ziel>   legt das SDK in <ziel> an
#
# sdkmanager ist ein Java-Programm: es braucht ein JDK oder JRE (17 oder neuer) im PATH.
set -euo pipefail

WERKZEUGE_FASSUNG=15859902
WERKZEUGE_SUMME=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
ANDROID_PLATTFORM="platforms;android-36"
ANDROID_BUILD_TOOLS="build-tools;36.0.0"
QUELLE="https://dl.google.com/android/repository/commandlinetools-linux-${WERKZEUGE_FASSUNG}_latest.zip"

ZIEL="${1:?Ziel fehlt – ANDROID_SDK_LIZENZ=angenommen scripts/android-sdk-holen.sh <ziel>}"
if [ "${ANDROID_SDK_LIZENZ:-}" != "angenommen" ]; then
  echo "Android-SDK: Es steht unter dem Lizenzvertrag von Google (https://developer.android.com/studio/terms)." >&2
  echo "Nur wer ihn gelesen hat und annimmt, setzt ANDROID_SDK_LIZENZ=angenommen – Abbruch, nichts geladen." >&2
  exit 1
fi

ARCHIV="$ZIEL/commandlinetools-linux-${WERKZEUGE_FASSUNG}_latest.zip"
stimmt() { [ -f "$1" ] && echo "$WERKZEUGE_SUMME  $1" | sha256sum -c --status -; }

mkdir -p "$ZIEL"
if ! stimmt "$ARCHIV"; then
  rm -f "$ARCHIV" "$ARCHIV.teil"
  curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' --tlsv1.2 -o "$ARCHIV.teil" "$QUELLE"
  stimmt "$ARCHIV.teil" || { rm -f "$ARCHIV.teil"; echo "Android-SDK: Summe der Werkzeuge stimmt nicht – Abbruch" >&2; exit 1; }
  mv "$ARCHIV.teil" "$ARCHIV"
fi

# nur entpacken, was unter cmdline-tools/ liegt – sdkmanager erwartet sich unter cmdline-tools/latest
if unzip -Z1 "$ARCHIV" | grep -qvE '^cmdline-tools/([A-Za-z0-9._+-]+/)*[A-Za-z0-9._+-]*$'; then
  echo "Android-SDK: unerwarteter Pfad im Archiv – Abbruch" >&2
  exit 1
fi
rm -rf "${ZIEL:?}/cmdline-tools" "$ZIEL/cmdline-tools.teil"
mkdir -p "$ZIEL/cmdline-tools.teil"
unzip -q "$ARCHIV" -d "$ZIEL/cmdline-tools.teil"
mkdir -p "$ZIEL/cmdline-tools"
mv "$ZIEL/cmdline-tools.teil/cmdline-tools" "$ZIEL/cmdline-tools/latest"
rmdir "$ZIEL/cmdline-tools.teil"
rm -f "$ARCHIV"

SDKMANAGER="$ZIEL/cmdline-tools/latest/bin/sdkmanager"
# die Annahme oben gilt für die Lizenzen, die sdkmanager für diese Pakete nennt; yes endet mit SIGPIPE, sobald sdkmanager
# genug gelesen hat – mit pipefail bräche das sonst das Skript ab
{ yes || true; } | "$SDKMANAGER" --sdk_root="$ZIEL" --licenses > /dev/null
"$SDKMANAGER" --sdk_root="$ZIEL" --install "$ANDROID_PLATTFORM" "$ANDROID_BUILD_TOOLS"
echo "Android-SDK geprüft: $ZIEL ($ANDROID_PLATTFORM, $ANDROID_BUILD_TOOLS)"
