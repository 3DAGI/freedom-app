#!/usr/bin/env bash
# ============================================================
# FreedomStack Provider-Installer
#
#   curl -fsSL https://freedomstack.io/install.sh | bash
#
# Macht aus einem Linux-Rechner (GX10, VPS, Laptop) einen Provider:
# Compute + Storage + Relay in einem Prozess.
#
# Env (optional):
#   NODE_LUD16=you@wallet.cash     Lightning-Adresse (wird sonst abgefragt)
#   PROVIDER_MODELS=a,b            Ollama-Modelle
#   STORAGE_ENABLED=1              Blob-Seeding (default an)
#   RELAY_ENABLED=1                eigener Relay (default an)
#   SKIP_MODEL_PULL=1              Modell nicht automatisch laden
#   FREEDOM_REPO=<git-url>         abweichende Quelle
# ============================================================
set -euo pipefail

FREEDOM_DIR="${FREEDOM_DIR:-$HOME/freedomstack}"
FREEDOM_REPO="${FREEDOM_REPO:-https://github.com/DEIN-USER/freedomstack.git}"
BRANCH="${BRANCH:-main}"
STATE_DIR="$HOME/.freedom"
KEY_FILE="$STATE_DIR/node-key"
ENV_FILE="$STATE_DIR/node.env"
QUOTA_API_PORT="${QUOTA_API_PORT:-3602}"

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; DIM=$'\e[2m'; RST=$'\e[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s+%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '%s* %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }
step() { printf '\n%s-- %s%s\n' "$DIM" "$*" "$RST"; }

# Interaktiv nur, wenn ein Terminal da ist. Bei "curl | bash" haengt stdin an
# der Pipe — dann lesen wir von /dev/tty, sonst gaebe es keine Rueckfrage.
if [ -r /dev/tty ]; then TTY=/dev/tty; else TTY=""; fi

say "=============================================="
say "  FreedomStack Provider-Installer"
say "=============================================="

# ------------------------------------------------ 1. Systemvoraussetzungen
step "1/7  System pruefen"

[ "$(uname -s)" = "Linux" ] || warn "Nicht getestet auf $(uname -s) — weiter auf eigenes Risiko."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null; then SUDO="sudo"; else warn "kein sudo — Systempakete werden uebersprungen"; fi
fi

for c in git curl; do
  command -v "$c" >/dev/null || die "'$c' fehlt. Bitte installieren: apt-get install -y $c"
done

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  say "-- installiere Node.js 22 ..."
  [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ] || die "Node.js >= 20 fehlt und ohne sudo kann ich es nicht installieren."
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
ok "node $(node -v)"

# ------------------------------------------------ 2. Ollama
step "2/7  Inferenz-Backend (Ollama)"

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
if ! curl -fsS --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  if command -v ollama >/dev/null; then
    say "-- Ollama installiert, aber nicht erreichbar. Starte Dienst ..."
    $SUDO systemctl start ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &)
    sleep 3
  else
    say "-- installiere Ollama ..."
    curl -fsSL https://ollama.com/install.sh | sh
    sleep 3
  fi
fi
curl -fsS --max-time 5 "$OLLAMA_URL/api/tags" >/dev/null 2>&1 \
  || die "Ollama unter $OLLAMA_URL nicht erreichbar. Der Provider kann ohne Inferenz nicht arbeiten."
ok "Ollama erreichbar"

# ------------------------------------------------ 3. Lightning-Adresse
step "3/7  Auszahlungsadresse"

if [ -z "${NODE_LUD16:-}" ] && [ -f "$ENV_FILE" ]; then
  NODE_LUD16="$(grep -m1 '^NODE_LUD16=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
fi

# Frueher stand hier ein Default "test@wallet.cash". Der fuehrt dazu, dass ein
# Provider arbeitet und die Einnahmen an eine fremde Adresse gehen — deshalb
# wird jetzt gefragt und im Zweifel abgebrochen.
if [ -z "${NODE_LUD16:-}" ]; then
  if [ -n "$TTY" ]; then
    printf 'Deine Lightning-Adresse fuer Einnahmen (z.B. name@walletofsatoshi.com): '
    read -r NODE_LUD16 < "$TTY"
  else
    die "NODE_LUD16 fehlt. Aufruf: NODE_LUD16=du@wallet.cash bash install-freedom.sh"
  fi
fi
case "$NODE_LUD16" in
  *@*.*) ok "Auszahlung an $NODE_LUD16" ;;
  *) die "'$NODE_LUD16' sieht nicht wie eine Lightning-Adresse aus (name@domain.tld)." ;;
esac

# ------------------------------------------------ 4. Repo
step "4/7  Code holen"

if [ -d "$FREEDOM_DIR/.git" ]; then
  git -C "$FREEDOM_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$FREEDOM_DIR" reset --hard "origin/$BRANCH"
  ok "aktualisiert: $FREEDOM_DIR"
else
  git clone --depth 1 -b "$BRANCH" "$FREEDOM_REPO" "$FREEDOM_DIR"
  ok "geklont: $FREEDOM_DIR"
fi

cd "$FREEDOM_DIR"
say "-- installiere Abhaengigkeiten (dauert 1-2 Minuten) ..."
npm install --workspaces --include-workspace-root --no-audit --no-fund >/dev/null 2>&1 \
  || npm install --no-audit --no-fund >/dev/null 2>&1 \
  || die "npm install fehlgeschlagen — Details: cd $FREEDOM_DIR && npm install"
ok "Abhaengigkeiten installiert"

# ------------------------------------------------ 5. Identitaet
step "5/7  Provider-Identitaet"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if [ ! -f "$KEY_FILE" ]; then
  if command -v openssl >/dev/null; then
    openssl rand -hex 32 > "$KEY_FILE"
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$KEY_FILE"
  fi
  chmod 600 "$KEY_FILE"
  warn "NEUER Provider-Key erzeugt: $KEY_FILE"
  warn "Ohne Backup ist deine Reputation bei Datenverlust weg. Jetzt sichern."
else
  chmod 600 "$KEY_FILE"
  ok "bestehende Identitaet wiederverwendet"
fi
NODE_SECRET_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
[ ${#NODE_SECRET_KEY} -eq 64 ] || die "Key in $KEY_FILE ist defekt (erwartet 64 Hex-Zeichen)."

# Startzeitpunkt EINMAL festhalten. Ohne das startet die 24h-Gratisphase bei
# jedem Neustart neu und der Provider verdient nie etwas.
if [ ! -f "$STATE_DIR/provider-since" ]; then
  date +%s > "$STATE_DIR/provider-since"
  chmod 600 "$STATE_DIR/provider-since"
fi
PROVIDER_SINCE="$(cat "$STATE_DIR/provider-since")"

# ------------------------------------------------ 6. Modelle
step "6/7  Modelle"

# Region grob erfragen: sie steuert den Knappheitsbonus. Ein Knoten in einer
# unterversorgten Region verdient mehr als der zwanzigste in Mitteleuropa.
if [ -z "${REGION:-}" ] && [ -f "$ENV_FILE" ]; then
  REGION="$(grep -m1 '^REGION=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
fi
if [ -z "${REGION:-}" ]; then
  if [ -n "$TTY" ]; then
    printf 'Deine Region (eu/na/sa/af/as/oc) [eu]: '
    read -r REGION < "$TTY"
  fi
  REGION="${REGION:-eu}"
fi
case "$REGION" in
  eu|na|sa|af|as|oc) ok "Region: $REGION" ;;
  *) warn "'$REGION' ist keine bekannte Region — kein Knappheitsbonus."; REGION="" ;;
esac

PROVIDER_MODELS="${PROVIDER_MODELS:-qwen2.5:7b}"
OLLAMA_MODEL="${OLLAMA_MODEL:-${PROVIDER_MODELS%%,*}}"

if [ "${SKIP_MODEL_PULL:-0}" != "1" ]; then
  if ! curl -fsS "$OLLAMA_URL/api/tags" | grep -q "${OLLAMA_MODEL%%:*}"; then
    say "-- lade Modell $OLLAMA_MODEL (kann einige Minuten dauern) ..."
    ollama pull "$OLLAMA_MODEL" || warn "Pull fehlgeschlagen — bitte manuell: ollama pull $OLLAMA_MODEL"
  fi
fi
ok "primaeres Modell: $OLLAMA_MODEL"

# ------------------------------------------------ 7. Dienst
step "7/7  Dienst einrichten"

cat > "$ENV_FILE" <<ENV_EOF
NODE_SECRET_KEY=$NODE_SECRET_KEY
NODE_LUD16=$NODE_LUD16
PROVIDER_SINCE=$PROVIDER_SINCE
REGION=$REGION
OLLAMA_URL=$OLLAMA_URL
PROVIDER_MODELS=$PROVIDER_MODELS
OLLAMA_MODEL=$OLLAMA_MODEL
STORAGE_ENABLED=${STORAGE_ENABLED:-1}
BOOTSTRAP_SEEDER=${BOOTSTRAP_SEEDER:-0}
RELAY_ENABLED=${RELAY_ENABLED:-1}
RELAY_PORT=${RELAY_PORT:-7777}
# Oeffentliche Adresse des eigenen Relays. OHNE sie laeuft der Relay zwar,
# ist fuer das Netz aber unsichtbar — und traegt nichts zur Zensurresistenz
# bei. Erst die Ankuendigung macht das Netz selbsttragend.
RELAY_PUBLIC_URL=${RELAY_PUBLIC_URL:-}
FREE_TOKENS_PER_DAY=${FREE_TOKENS_PER_DAY:-2000}
QUOTA_API_PORT=$QUOTA_API_PORT
ENV_EOF
chmod 600 "$ENV_FILE"

MODE="vordergrund"
if command -v systemctl >/dev/null && { [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; }; then
  $SUDO tee /etc/systemd/system/freedom-node.service >/dev/null <<UNIT_EOF
[Unit]
Description=FreedomStack Provider Node
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$FREEDOM_DIR/packages/node
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) --import tsx src/main.ts
Restart=always
RestartSec=10
# Der Provider verarbeitet fremde Prompts — Rechte so eng wie moeglich halten.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$HOME/freedom-data $STATE_DIR

[Install]
WantedBy=multi-user.target
UNIT_EOF
  mkdir -p "$HOME/freedom-data"
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now freedom-node
  sleep 4

  if $SUDO systemctl is-active --quiet freedom-node; then
    ok "Dienst laeuft"
    MODE="systemd"
  else
    $SUDO systemctl status freedom-node --no-pager -n 20 || true
    die "Dienst startet nicht — Logs oben."
  fi

  # Nachweis statt Behauptung: die Quota-API antwortet nur, wenn der Node lebt.
  ZERO_PK="$(printf '0%.0s' $(seq 64))"
  if curl -fsS --max-time 5 "http://127.0.0.1:$QUOTA_API_PORT/api/quota?pk=$ZERO_PK" >/dev/null 2>&1; then
    ok "Quota-API antwortet — der Knoten ist erreichbar"
  else
    warn "Quota-API antwortet noch nicht — beim ersten Start normal."
  fi
else
  warn "kein systemd/sudo — starte im Vordergrund (Strg+C beendet)"
fi

PUBKEY="$(node -e "
  const {schnorr}=require('$FREEDOM_DIR/node_modules/@noble/curves/secp256k1.js');
  const sk=Uint8Array.from('$NODE_SECRET_KEY'.match(/../g).map(h=>parseInt(h,16)));
  process.stdout.write(Buffer.from(schnorr.getPublicKey(sk)).toString('hex'));
" 2>/dev/null || echo "unbekannt")"

say ""
say "=============================================="
ok  "Provider laeuft."
say "=============================================="
say "  pubkey    : $PUBKEY"
say "  Auszahlung: $NODE_LUD16"
say "  Modelle   : $PROVIDER_MODELS"
say "  Key-Backup: $KEY_FILE  (unbedingt sichern)"
say ""
say "  Die ersten 24h arbeitet der Knoten gratis — das baut die Reputation auf,"
say "  die spaeter bezahlte Jobs bringt. Danach schaltet er automatisch um."
say ""
if [ "$MODE" = "systemd" ]; then
  say "  Logs   : journalctl -u freedom-node -f"
  say "  Stoppen: sudo systemctl stop freedom-node"
fi
say "  Status : https://freedomstack.io/dashboard.html  (Suche nach deinem pubkey)"
say ""

if [ "$MODE" = "vordergrund" ]; then
  cd "$FREEDOM_DIR/packages/node"
  set -a; . "$ENV_FILE"; set +a
  exec node --import tsx src/main.ts
fi
