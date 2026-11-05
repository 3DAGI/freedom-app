#!/usr/bin/env bash
# Gradle für den Motor (VKh2a, `docs/ANDROID-ENTWURF.md`, VKh-W1 C): die offizielle Distribution in fester Fassung holen und
# gegen SHA-256 prüfen – die Summe steht hier fest, nie zur Laufzeit gelesen (die CI vergleicht sie mit der von gradle.org).
# Debian 12 bringt nur Gradle 4.4, zu alt für das Android-Plugin. Gradle (Apache-2.0) ist ein eigenes Programm, das der
# Motor nur in seiner Sandbox startet; Bibliotheken holt es dort nur über den Spiegel der Brücke (VKh1).
#
#   scripts/gradle-holen.sh <ziel>   legt <ziel>/gradle-<fassung>/ an (darin bin/gradle, lib/, LICENSE, NOTICE)
#
# Liegt das Archiv mit richtiger Summe schon in <ziel> (Zwischenspeicher der CI), wird es nicht neu geladen.
set -euo pipefail

GRADLE_FASSUNG=9.8.2
GRADLE_SUMME=21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607
QUELLE="https://services.gradle.org/distributions/gradle-$GRADLE_FASSUNG-bin.zip"

ZIEL="${1:?Ziel fehlt – scripts/gradle-holen.sh <ziel>}"
ARCHIV="$ZIEL/gradle-$GRADLE_FASSUNG-bin.zip"
ORDNER="gradle-$GRADLE_FASSUNG"

stimmt() { [ -f "$1" ] && echo "$GRADLE_SUMME  $1" | sha256sum -c --status -; }

mkdir -p "$ZIEL"
if ! stimmt "$ARCHIV"; then
  rm -f "$ARCHIV" "$ARCHIV.teil"
  # services.gradle.org leitet auf die Releases bei GitHub weiter – nur über https
  curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' --tlsv1.2 -o "$ARCHIV.teil" "$QUELLE"
  stimmt "$ARCHIV.teil" || { rm -f "$ARCHIV.teil"; echo "Gradle: Summe stimmt nicht – Abbruch" >&2; exit 1; }
  mv "$ARCHIV.teil" "$ARCHIV"
fi

# nur entpacken, was unter gradle-<fassung>/ liegt – nie einen Pfad mit .. oder von der Wurzel
if unzip -Z1 "$ARCHIV" | grep -qvE "^$ORDNER/([A-Za-z0-9._+-]+/)*[A-Za-z0-9._+-]*$"; then
  echo "Gradle: unerwarteter Pfad im Archiv – Abbruch" >&2
  exit 1
fi
rm -rf "${ZIEL:?}/$ORDNER" "$ZIEL/$ORDNER.teil"
mkdir "$ZIEL/$ORDNER.teil"
unzip -q "$ARCHIV" -d "$ZIEL/$ORDNER.teil"
mv "$ZIEL/$ORDNER.teil/$ORDNER" "$ZIEL/$ORDNER"
rmdir "$ZIEL/$ORDNER.teil"
echo "Gradle $GRADLE_FASSUNG geprüft: $ZIEL/$ORDNER/bin/gradle"
