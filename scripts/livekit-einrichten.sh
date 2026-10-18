#!/usr/bin/env bash
# SFU für Gruppenanrufe einrichten (Sammlung B-34a, Entscheidungen LK2–LK4 A, docs/GRUPPENANRUF-ENTWURF.md).
#
# Schreibt eine Konfiguration für livekit-server (nur für den Besitzer lesbar, 0600) und gibt die Zeilen für die
# Umgebung des Knotens aus:
#
#   bash scripts/livekit-einrichten.sh <ziel/livekit.yaml> <öffentlicher-name> [--docker]
#
# Mit --docker kommen zwei Zeilen dazu (LIVEKIT_UID, LIVEKIT_GID): Der Container läuft dann als dieser Nutzer und kann
# die Datei mit 0600 lesen.
#
# - Zugänge vergibt nur der Knoten (JWT mit LIVEKIT_API_SECRET, B-34a), sonst niemand.
# - Das Signal hört nur auf 127.0.0.1 – davor gehört ein Reverse-Proxy mit TLS (wss://<name>). Bild und Ton gehen über
#   die RTC-Ports; die Teilnehmer kommen über ihren eigenen TURN (LK4 A), dann sieht der SFU nur dessen Adresse.
# - Kein eigener TURN im SFU, kein Redis (ein Knoten), höchstens 25 Teilnehmer je Raum, Protokoll nur ab „warn“ –
#   Beitritte und Adressen gehören nicht in ein Log.
# - Schlüssel und Geheimnis entstehen hier zufällig und erscheinen nur in der Datei und in der Ausgabe für die
#   Umgebungsdatei – nie auf der Befehlszeile von livekit-server.
set -euo pipefail

ziel="${1:-}"
name="${2:-}"
docker="${3:-}"
if [[ -z "$ziel" || -z "$name" || ( -n "$docker" && "$docker" != "--docker" ) ]]; then
  echo "Aufruf: bash scripts/livekit-einrichten.sh <ziel/livekit.yaml> <öffentlicher-name> [--docker]" >&2
  exit 2
fi
# Nur ein Name aus Buchstaben, Ziffern, Punkt und Bindestrich – er landet in LIVEKIT_URL
if ! [[ "$name" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,188}[A-Za-z0-9])?$ ]]; then
  echo "Ungültiger Name: nur Buchstaben, Ziffern, Punkt und Bindestrich" >&2
  exit 2
fi
if [[ -e "$ziel" ]]; then
  echo "$ziel gibt es schon – nicht überschrieben (Schlüssel und Geheimnis darin gelten weiter)" >&2
  exit 1
fi

schluessel="API$(head -c 9 /dev/urandom | od -An -tx1 | tr -d ' \n')"
geheimnis="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
[[ "$schluessel" =~ ^API[0-9a-f]{18}$ && "$geheimnis" =~ ^[0-9a-f]{64}$ ]] || { echo "Kein Zufall verfügbar" >&2; exit 1; }

umask 077
mkdir -p "$(dirname "$ziel")"
cat > "$ziel" <<CONF
# FreedomStack: SFU für Gruppenanrufe (B-34a) – erzeugt von scripts/livekit-einrichten.sh.
# Zugänge vergibt nur der Knoten (LIVEKIT_API_SECRET); ändern nur mit Bedacht.
port: 7880
bind_addresses:
  - 127.0.0.1
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
keys:
  $schluessel: $geheimnis
room:
  auto_create: true
  max_participants: 25
  empty_timeout: 300
turn:
  enabled: false
logging:
  level: warn
  pion_level: error
CONF
chmod 600 "$ziel"

echo "LIVEKIT_URL=wss://$name"
echo "LIVEKIT_API_KEY=$schluessel"
echo "LIVEKIT_API_SECRET=$geheimnis"
if [[ "$docker" == "--docker" ]]; then
  echo "LIVEKIT_UID=$(id -u)"
  echo "LIVEKIT_GID=$(id -g)"
fi
