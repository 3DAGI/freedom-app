# Provider-Knoten.
#
# Bewusst schlank: Playwright ist eine OPTIONALE Abhaengigkeit (~300 MB inkl.
# Browser) und kommt nur mit VIBECODEN=1 ins Bild (Browser des Motors, VKk1) —
# dem Normalfall diese Groesse aufzuzwingen waere der falsche Standardfall.
# whisper-cli für Text aus Sprache (B-38b3, SP-W1 A) – nur mit WHISPER=1 gebaut (docker-compose.sprache.yml), aus den
# Quellen in fester Fassung (scripts/whisper-bauen.sh; whisper.cpp ist MIT, der Text liegt im Bild). Eigene Stufe: Compiler
# und cmake bleiben draußen, ins Bild kommen nur das Programm und seine Lizenz. Ohne WHISPER=1 bleibt /aus leer.
FROM node:22-slim AS whisper-bau
ARG WHISPER=0
COPY scripts/whisper-bauen.sh /tmp/whisper-bauen.sh
RUN mkdir -p /aus && if [ "$WHISPER" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
      && bash /tmp/whisper-bauen.sh /tmp/whisper \
      && install -D -m 0755 /tmp/whisper/whisper-cli /aus/usr/local/bin/whisper-cli \
      && install -D -m 0644 /tmp/whisper/whisper.cpp-LICENSE /aus/usr/local/share/doc/whisper.cpp/LICENSE; \
    fi

FROM node:22-slim

# Nicht als root laufen. Der Knoten verarbeitet fremde Prompts; alles, was den
# Rechteumfang begrenzt, ist hier eine Investition.
RUN useradd -m -u 1001 -s /bin/bash freedom || true

# aria2c für Modelle im Schwarm (B-29c2c, nur mit TORRENT=1) – eigenes Programm,
# GPL-2.0+, als getrennter Prozess ohne Folge für die Lizenz des Knotens (EUPL-1.2).
# git für Projekte zum Vibecoden (A-31 VKc1, VK-W2 A, nur mit VIBECODEN=1) – ebenso
# eigenes Programm (GPL-2.0), als getrennter Prozess aufgerufen.
# bubblewrap für die Sandbox (VKb, LGPL-2.0+, getrennter Prozess) – unter Docker sperrt
# das Standard-Seccomp meist Nutzer-Namensräume: dann meldet es die Selbstprüfung, Code läuft nicht.
# kiwix-serve für Wissen ohne Internet (B-31b, Paket kiwix-tools, GPL-3.0+, rund 5 MB mit Bibliotheken) – eigenes
# Programm, nur in der Sandbox gestartet, nur mit einem Server „kiwix“ in ~/.freedom/mcp.json.
RUN apt-get update && apt-get install -y --no-install-recommends aria2 bubblewrap git kiwix-tools \
    && rm -rf /var/lib/apt/lists/*

# whisper-cli aus der Stufe oben (nur mit WHISPER=1 – sonst kommt nichts)
COPY --from=whisper-bau /aus/ /

# Hermes Agent für Vibecoden (VKc3b, Entscheidung VK-W1n C) – nur mit VIBECODEN=1 gebaut
# (docker-compose.vibecoden.yml reicht es durch): eigenes venv in /opt/hermes (HERMES_ORDNER), jedes
# Paket mit Hash aus docker/hermes-requirements.txt, nur fertige Wheels, nichts nachgeladen. Hermes
# (MIT) läuft nur in der Sandbox (hermes-motor.ts); python3 und ripgrep sind eigene Programme.
# Chromium (BSD-3 u. a., aus Debian) und Schriften für den Browser des Motors (VKk1, VKg-W2) – ebenfalls nur in
# der Sandbox, gesteuert von Playwright MCP aus playwright-core (mcp-katalog.ts).
# Bildstrom (VKg2c1, VKg-W2): Xvfb (MIT/X11), GStreamer mit webrtcbin und libnice (LGPL-2.1+), PyGObject und
# python-xlib (LGPL-2.1+) – eigene Programme, nur in der Bild-Sandbox (bildstrom.ts); Chromium zeigt dort Web-Projekte.
ARG VIBECODEN=0
COPY docker/hermes-requirements.txt /tmp/hermes-requirements.txt
RUN if [ "$VIBECODEN" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ripgrep chromium fonts-liberation \
        xvfb gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-nice \
        gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 python3-gi python3-xlib \
      && rm -rf /var/lib/apt/lists/* \
      && python3 -m venv /opt/hermes \
      && /opt/hermes/bin/pip install --no-cache-dir --disable-pip-version-check --require-hashes \
           --only-binary :all: --no-deps -r /tmp/hermes-requirements.txt; \
    fi && rm /tmp/hermes-requirements.txt
WORKDIR /app

# Erst die Manifeste kopieren: So bleibt der Installationsschritt im Cache,
# solange sich nur der Quelltext aendert.
COPY package.json package-lock.json* ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/mls/package.json packages/mls/
COPY packages/node/package.json packages/node/

# Playwright (optional, ohne eigenen Browser – den bringt Debian) nur mit VIBECODEN=1 (VKk1)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN OPTIONAL=$([ "$VIBECODEN" = "1" ] || echo --omit=optional); \
    npm install --workspaces --include-workspace-root --no-audit --no-fund $OPTIONAL \
    || npm install --no-audit --no-fund $OPTIONAL

COPY packages/protocol packages/protocol
# MLS-Engine (gebaut, dist/) – für den Agenten in privaten Räumen (11.3d2a, AGENT_PRIVAT)
COPY packages/mls/src packages/mls/src
COPY packages/mls/dist packages/mls/dist
COPY packages/node packages/node

RUN mkdir -p /home/node/.freedom /home/node/freedom-data \
    && chown -R freedom:freedom /app /home/node
USER freedom
ENV HOME=/home/node

WORKDIR /app/packages/node

# Startet nur mit gesetzter Auszahlungsadresse — main.ts bricht sonst mit
# einer klaren Meldung ab.
CMD ["node", "--import", "tsx", "src/main.ts"]
