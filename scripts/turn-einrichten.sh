#!/usr/bin/env bash
# TURN für Anrufe einrichten (Sammlung B-13b, Entscheidungen T1 A, T2 A).
#
# Schreibt eine Konfiguration für coturn (nur für den Besitzer lesbar, 0600)
# und gibt die zwei Zeilen für die Umgebung des Knotens aus:
#
#   bash scripts/turn-einrichten.sh <ziel/turnserver.conf> <öffentlicher-name> [--docker]
#
# Mit --docker kommen zwei Zeilen dazu (TURN_UID, TURN_GID): Der Container läuft
# dann als dieser Nutzer und kann die Datei mit 0600 lesen.
#
# - Nur TURN-REST: Zugänge vergibt der Knoten (`TURN_SECRET`, B-13a), sonst
#   niemand – keine festen Nutzer, kein Zugang ohne Geheimnis.
# - Nie in private Netze vermitteln: Ein TURN, der an 10.0.0.1 weiterreicht,
#   wäre ein Weg ins Heimnetz. Gesperrt sind alle privaten, lokalen und
#   reservierten Bereiche (IPv4 und IPv6).
# - Grenzen je Nutzer und gesamt; kein Protokoll auf der Platte (die IPs der
#   Gesprächspartner gehören nicht in ein Log).
# - Das Geheimnis entsteht hier zufällig (64 Hex-Zeichen) und erscheint nur in
#   der Datei und in der Ausgabe für die Umgebungsdatei – nie auf der
#   Befehlszeile von coturn.
set -euo pipefail

ziel="${1:-}"
name="${2:-}"
docker="${3:-}"
if [[ -z "$ziel" || -z "$name" || ( -n "$docker" && "$docker" != "--docker" ) ]]; then
  echo "Aufruf: bash scripts/turn-einrichten.sh <ziel/turnserver.conf> <öffentlicher-name> [--docker]" >&2
  exit 2
fi
# Nur ein Name aus Buchstaben, Ziffern, Punkt und Bindestrich – er landet in der Datei und in TURN_URLS
if ! [[ "$name" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,188}[A-Za-z0-9])?$ ]]; then
  echo "Ungültiger Name: nur Buchstaben, Ziffern, Punkt und Bindestrich" >&2
  exit 2
fi
if [[ -e "$ziel" ]]; then
  echo "$ziel gibt es schon – nicht überschrieben (das Geheimnis darin gilt weiter)" >&2
  exit 1
fi

geheimnis="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
[[ "$geheimnis" =~ ^[0-9a-f]{64}$ ]] || { echo "Kein Zufall verfügbar" >&2; exit 1; }

umask 077
mkdir -p "$(dirname "$ziel")"
cat > "$ziel" <<CONF
# FreedomStack: TURN für Anrufe (B-13b) – erzeugt von scripts/turn-einrichten.sh.
# Zugänge vergibt nur der Knoten (TURN-REST, TURN_SECRET); ändern nur mit Bedacht.
listening-port=3478
min-port=49160
max-port=49200
realm=$name
use-auth-secret
static-auth-secret=$geheimnis
fingerprint
no-cli
no-multicast-peers
# Nie in private, lokale oder reservierte Netze vermitteln
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::-::1
denied-peer-ip=::ffff:0.0.0.0-::ffff:255.255.255.255
denied-peer-ip=64:ff9b::-64:ff9b::ffff:ffff
denied-peer-ip=100::-100::ffff:ffff:ffff:ffff
denied-peer-ip=2001::-2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=2001:db8::-2001:db8:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=ff00::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
# Grenzen: Sitzungen je Nutzer und gesamt, Bandbreite je Sitzung in Byte/s (rund 4 Mbit/s – Video in guter Qualität)
user-quota=4
total-quota=40
max-bps=500000
stale-nonce=600
# Kein Protokoll: die IPs der Gesprächspartner gehören nicht auf die Platte
log-file=/dev/null
no-stdout-log
CONF
chmod 600 "$ziel"

echo "TURN_SECRET=$geheimnis"
echo "TURN_URLS=turn:$name:3478?transport=udp,turn:$name:3478?transport=tcp"
if [[ "$docker" == "--docker" ]]; then
  echo "TURN_UID=$(id -u)"
  echo "TURN_GID=$(id -g)"
fi
