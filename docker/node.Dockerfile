# Provider-Knoten.
#
# Bewusst schlank: Playwright ist eine OPTIONALE Abhaengigkeit (~300 MB inkl.
# Browser) und kommt nur mit VIBECODEN=1 ins Bild (Browser des Motors, VKk1) —
# dem Normalfall diese Groesse aufzuzwingen waere der falsche Standardfall.
# Basis fest auf Debian 12 (B-43): node:22-bookworm-slim, nie node:22-slim – das wandert mit der nächsten Debian-Fassung mit,
# und die Pakete hier sind für Debian 12 gewählt (Hangover für bookworm, Namen und Fassungen aus Debian). Alle Stufen gleich.
# whisper-cli für Text aus Sprache (B-38b3, SP-W1 A) – nur mit WHISPER=1 gebaut (docker-compose.sprache.yml), aus den
# Quellen in fester Fassung (scripts/whisper-bauen.sh; whisper.cpp ist MIT, der Text liegt im Bild). Eigene Stufe: Compiler
# und cmake bleiben draußen, ins Bild kommen nur das Programm und seine Lizenz. Ohne WHISPER=1 bleibt /aus leer.
FROM node:22-bookworm-slim AS whisper-bau
ARG WHISPER=0
COPY scripts/whisper-bauen.sh /tmp/whisper-bauen.sh
RUN mkdir -p /aus && if [ "$WHISPER" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
      && bash /tmp/whisper-bauen.sh /tmp/whisper \
      && install -D -m 0755 /tmp/whisper/whisper-cli /aus/usr/local/bin/whisper-cli \
      && install -D -m 0644 /tmp/whisper/whisper.cpp-LICENSE /aus/usr/local/share/doc/whisper.cpp/LICENSE; \
    fi

# Godot für Spiele im Bild (VKk3a) – nur mit VIBECODEN=1: das offizielle Release in fester Fassung, gegen SHA-512 geprüft
# (scripts/godot-holen.sh; MIT, Lizenztexte liegen im Bild). Eigene Stufe: curl und unzip bleiben draußen, ins Bild kommt
# nur das Programm (rund 150 MB). Ohne VIBECODEN=1 bleibt /aus leer.
FROM node:22-bookworm-slim AS godot-holen
ARG VIBECODEN=0
COPY scripts/godot-holen.sh /tmp/godot-holen.sh
RUN mkdir -p /aus && if [ "$VIBECODEN" = "1" ]; then apt-get update \
      && apt-get install -y --no-install-recommends curl ca-certificates unzip \
      && bash /tmp/godot-holen.sh /tmp/godot \
      && install -D -m 0755 /tmp/godot/godot /aus/usr/local/bin/godot \
      && install -D -m 0644 /tmp/godot/LICENSE.txt /aus/usr/local/share/doc/godot/LICENSE.txt \
      && install -D -m 0644 /tmp/godot/COPYRIGHT.txt /aus/usr/local/share/doc/godot/COPYRIGHT.txt; \
    fi

# Hangover für Windows-Programme auf ARM64 (VKi2) – nur mit VIBECODEN=1, WINE=1 und auf arm64: die Pakete des Releases in
# fester Fassung, gegen SHA-256 geprüft (scripts/hangover-holen.sh). Eigene Stufe: curl bleibt draußen; installiert werden die
# Pakete unten über einen Mount, damit das Archiv in keiner Schicht des Bilds liegt.
FROM node:22-bookworm-slim AS hangover-holen
ARG VIBECODEN=0
ARG WINE=0
COPY scripts/hangover-holen.sh /tmp/hangover-holen.sh
RUN mkdir -p /aus && if [ "$VIBECODEN" = "1" ] && [ "$WINE" = "1" ] && [ "$(dpkg --print-architecture)" = "arm64" ]; then apt-get update \
      && apt-get install -y --no-install-recommends curl ca-certificates \
      && bash /tmp/hangover-holen.sh /tmp/hangover bookworm \
      && mv /tmp/hangover/*.deb /aus/; \
    fi

# Gradle für den Motor (VKh2a) – nur mit VIBECODEN=1 und GRADLE=1: die offizielle Distribution in fester Fassung, gegen
# SHA-256 geprüft (scripts/gradle-holen.sh; Apache-2.0, LICENSE und NOTICE liegen im Ordner). Eigene Stufe: curl und unzip
# bleiben draußen, ins Bild kommt nur der Ordner (rund 170 MB) unter /usr/local – dort sieht ihn die Sandbox. Ohne beide
# Schalter bleibt /aus leer.
FROM node:22-bookworm-slim AS gradle-holen
ARG VIBECODEN=0
ARG GRADLE=0
COPY scripts/gradle-holen.sh /tmp/gradle-holen.sh
RUN mkdir -p /aus && if [ "$VIBECODEN" = "1" ] && [ "$GRADLE" = "1" ]; then apt-get update \
      && apt-get install -y --no-install-recommends curl ca-certificates unzip \
      && bash /tmp/gradle-holen.sh /tmp/gradle \
      && mkdir -p /aus/usr/local/lib /aus/usr/local/bin \
      && mv /tmp/gradle/gradle-*/ /aus/usr/local/lib/gradle \
      && ln -s ../lib/gradle/bin/gradle /aus/usr/local/bin/gradle; \
    fi

# Android-SDK für APKs (VKh2b) – nur mit VIBECODEN=1 und ANDROID=1, dazu GRADLE=1: die Kommandozeilen-Werkzeuge von Google in
# fester Fassung, gegen SHA-256 geprüft, eine Plattform und eine Fassung der Build-Tools (scripts/android-sdk-holen.sh). Das SDK
# steht unter dem Lizenzvertrag von Google – annehmen kann ihn nur, wer das Bild baut (ANDROID_SDK_LIZENZ=angenommen), sonst
# bricht der Bau ab. Ein Bild mit SDK nicht weitergeben. Eigene Stufe: curl, unzip, das JRE für sdkmanager und sdkmanager selbst
# bleiben draußen; ins Bild kommt das SDK unter /usr/lib/android-sdk (dort sieht es die Sandbox), rund 300 MB.
FROM node:22-bookworm-slim AS android-sdk-holen
ARG VIBECODEN=0
ARG GRADLE=0
ARG ANDROID=0
ARG ANDROID_SDK_LIZENZ=
COPY scripts/android-sdk-holen.sh /tmp/android-sdk-holen.sh
RUN mkdir -p /aus && if [ "$VIBECODEN" = "1" ] && [ "$ANDROID" = "1" ]; then \
      if [ "$GRADLE" != "1" ]; then echo "ANDROID=1 braucht GRADLE=1" >&2; exit 1; fi; \
      mkdir -p /usr/share/man/man1 && apt-get update \
      && apt-get install -y --no-install-recommends curl ca-certificates unzip openjdk-17-jre-headless \
      && ANDROID_SDK_LIZENZ="$ANDROID_SDK_LIZENZ" bash /tmp/android-sdk-holen.sh /aus/usr/lib/android-sdk \
      && rm -rf /aus/usr/lib/android-sdk/cmdline-tools; \
    fi

# aapt2 für ARM64 (VKh3b) – nur mit VIBECODEN=1, ANDROID=1 und auf arm64: aus den AOSP-Quellen gebaut (scripts/aapt2-bauen.sh –
# jedes Repo und das Rezept am Commit, die Pakete zum Bauen aus dem Skript, wie im CI-Job „aapt2 aus den Quellen“). Google liefert
# aapt2 nur für x86-64; dort nimmt das Android-Plugin seins aus Maven. Eigene Stufe: Compiler, cmake und die Quellen (rund 6 GB)
# bleiben draußen, ins Bild kommen das Programm und die Lizenztexte. Rund 15–25 min auf dem GX10.
FROM node:22-bookworm-slim AS aapt2-bauen
ARG VIBECODEN=0
ARG ANDROID=0
COPY scripts/aapt2-bauen.sh /tmp/aapt2-bauen.sh
RUN mkdir -p /aus && if [ "$VIBECODEN" = "1" ] && [ "$ANDROID" = "1" ] && [ "$(dpkg --print-architecture)" = "arm64" ]; then \
      pakete="$(sed -n 's/^AAPT2_BAU_PAKETE="\(.*\)"$/\1/p' /tmp/aapt2-bauen.sh)" \
      && apt-get update && apt-get install -y --no-install-recommends $pakete \
      && bash /tmp/aapt2-bauen.sh /tmp/aapt2 \
      && install -D -m 0755 /tmp/aapt2/aapt2 /aus/usr/local/bin/aapt2 \
      && mkdir -p /aus/usr/local/share/doc/aapt2 && install -m 0644 /tmp/aapt2/aapt2-lizenzen/* /aus/usr/local/share/doc/aapt2/; \
    fi

FROM node:22-bookworm-slim

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
# Godot aus der Stufe oben (nur mit VIBECODEN=1 – sonst kommt nichts)
COPY --from=godot-holen /aus/ /
# Gradle aus der Stufe oben (nur mit VIBECODEN=1 und GRADLE=1 – sonst kommt nichts)
COPY --from=gradle-holen /aus/ /
# Android-SDK aus der Stufe oben (nur mit VIBECODEN=1 und ANDROID=1 – sonst kommt nichts)
COPY --from=android-sdk-holen /aus/ /
# aapt2 aus den Quellen (nur mit VIBECODEN=1 und ANDROID=1 auf arm64 – sonst kommt nichts); braucht nur glibc, libstdc++, zlib
COPY --from=aapt2-bauen /aus/ /

# Hermes Agent für Vibecoden (VKc3b, Entscheidung VK-W1n C) – nur mit VIBECODEN=1 gebaut
# (docker-compose.vibecoden.yml reicht es durch): eigenes venv in /opt/hermes (HERMES_ORDNER), jedes
# Paket mit Hash aus docker/hermes-requirements.txt, nur fertige Wheels, nichts nachgeladen. Hermes
# (MIT) läuft nur in der Sandbox (hermes-motor.ts); python3 und ripgrep sind eigene Programme.
# Chromium (BSD-3 u. a., aus Debian) und Schriften für den Browser des Motors (VKk1, VKg-W2) – ebenfalls nur in
# der Sandbox, gesteuert von Playwright MCP aus playwright-core (mcp-katalog.ts).
# Bildstrom (VKg2c1, VKg-W2): Xvfb (MIT/X11), GStreamer mit webrtcbin und libnice (LGPL-2.1+), PyGObject und
# python-xlib (LGPL-2.1+) – eigene Programme, nur in der Bild-Sandbox (bildstrom.ts); Chromium zeigt dort Web-Projekte.
# Notebooks ausführen (VKk2b): ipykernel und nbclient (BSD-3) aus Debian – der Motor führt sie im Terminal in seiner
# Sandbox aus (mcp/notebook_ausfuehren.py), nie die Jupyter-Brücke selbst.
# Godot-Projekte im Bild (VKk3a): OpenGL über Mesa in Software (libgl1, libglx-mesa0, libgl1-mesa-dri, MIT) und die
# X-Bibliotheken, die Godot zur Laufzeit lädt – nur in der Sandbox des Programms.
# OpenSCAD-Modelle im Bild (VKk4a): OpenSCAD aus Debian (GPL-2.0+, eigenes Programm, nur in den Sandboxen) – zeigt main.scad im Bild
# und rechnet im Terminal des Motors Modelle (STL); Bilder (PNG) brauchen einen Bildschirm, die zeigt das Bild.
ARG VIBECODEN=0
COPY docker/hermes-requirements.txt /tmp/hermes-requirements.txt
RUN if [ "$VIBECODEN" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ripgrep chromium fonts-liberation \
        xvfb gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-nice \
        gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 python3-gi python3-xlib python3-ipykernel python3-nbclient \
        libgl1 libglx-mesa0 libgl1-mesa-dri libxcursor1 libxinerama1 libxi6 libxrandr2 openscad \
      && rm -rf /var/lib/apt/lists/* \
      && python3 -m venv /opt/hermes \
      && /opt/hermes/bin/pip install --no-cache-dir --disable-pip-version-check --require-hashes \
           --only-binary :all: --no-deps -r /tmp/hermes-requirements.txt; \
    fi && rm /tmp/hermes-requirements.txt

# Windows-Programme im Bild (VKi1, VKi2) – nur mit VIBECODEN=1 und WINE=1 (docker-compose.vibecoden.yml reicht es durch).
# amd64: Wine der Distribution (LGPL-2.1+), zusammen mit mingw-w64 rund 1,2 GB. arm64 (GX10): Hangover aus der Stufe oben –
# Wine mit FEX für x86_64 und box64 für 32 Bit (LGPL-2.1+ bzw. MIT), zusammen mit mingw-w64 rund 3 GB. Wine startet main.exe in
# der Sandbox des Programms (bildstrom.ts), mingw-w64 (GCC, GPL mit Ausnahme für die Laufzeit) baut Windows-Programme im
# Terminal des Motors – eigene Programme, getrennte Prozesse.
ARG WINE=0
RUN --mount=type=bind,from=hangover-holen,source=/aus,target=/tmp/hangover \
    if [ "$VIBECODEN" = "1" ] && [ "$WINE" = "1" ]; then \
      apt-get update && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
        apt-get install -y --no-install-recommends wine wine64 gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64; \
      else \
        apt-get install -y --no-install-recommends /tmp/hangover/*.deb gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64; \
      fi && rm -rf /var/lib/apt/lists/*; \
    fi

# Schaltpläne im Bild (VKk4b) – nur mit VIBECODEN=1 und KICAD=1 (docker-compose.vibecoden.yml reicht es durch). KiCad mit
# Symbolen und Footprints (GPL-3.0+ bzw. CC-BY-SA-4.0, eigenes Programm, nur in den Sandboxen), zusammen rund 700 MB. Aus
# bookworm-backports: Debian 12 selbst hat nur KiCad 6, ohne kicad-cli für Prüfungen und Exporte im Terminal des Motors.
ARG KICAD=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$KICAD" = "1" ]; then \
      echo "deb http://deb.debian.org/debian bookworm-backports main" > /etc/apt/sources.list.d/bookworm-backports.list \
      && apt-get update && apt-get install -y --no-install-recommends -t bookworm-backports kicad kicad-symbols kicad-footprints \
      && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/bookworm-backports.list; \
    fi

# Szenen im Bild (VKk4c) – nur mit VIBECODEN=1 und BLENDER=1 (docker-compose.vibecoden.yml reicht es durch). Blender aus Debian
# (GPL-3.0+, eigenes Programm, nur in den Sandboxen), rund 400 MB – zeigt main.blend im Bild und baut Szenen im Terminal des Motors.
ARG BLENDER=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$BLENDER" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends blender && rm -rf /var/lib/apt/lists/*; \
    fi

# Dokumente im Bild (VKk4d) – nur mit VIBECODEN=1 und LIBREOFFICE=1 (docker-compose.vibecoden.yml reicht es durch). LibreOffice
# aus Debian (MPL-2.0, eigenes Programm, nur in den Sandboxen) mit Writer, Calc, Impress und Draw, rund 400 MB – zeigt main.odt
# & Co. im Bild und wandelt im Terminal des Motors um (soffice --headless).
ARG LIBREOFFICE=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$LIBREOFFICE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Zeichnungen im Bild (VKk4e) – nur mit VIBECODEN=1 und INKSCAPE=1 (docker-compose.vibecoden.yml reicht es durch). Inkscape aus
# Debian (GPL-3.0+, eigenes Programm, nur in den Sandboxen), rund 200 MB – zeigt main.svg im Bild und exportiert im Terminal des Motors.
ARG INKSCAPE=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$INKSCAPE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends inkscape && rm -rf /var/lib/apt/lists/*; \
    fi

# Bilder im Bild (VKk4f) – nur mit VIBECODEN=1 und GIMP=1 (docker-compose.vibecoden.yml reicht es durch). GIMP 2.10 aus Debian
# (GPL-3.0+, eigenes Programm, nur in den Sandboxen), rund 250 MB – zeigt main.xcf im Bild, Script-Fu im Terminal des Motors.
ARG GIMP=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$GIMP" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends gimp && rm -rf /var/lib/apt/lists/*; \
    fi

# Karten im Bild (VKk4g) – nur mit VIBECODEN=1 und QGIS=1 (docker-compose.vibecoden.yml reicht es durch). QGIS aus Debian
# (GPL-2.0+, eigenes Programm, nur in den Sandboxen), mit GDAL, PROJ und PyQGIS bis zu 900 MB – zeigt main.qgs im Bild, PyQGIS und
# qgis_process im Terminal des Motors.
ARG QGIS=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$QGIS" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends qgis && rm -rf /var/lib/apt/lists/*; \
    fi

# Videos im Bild (VKk4h) – nur mit VIBECODEN=1 und SHOTCUT=1 (docker-compose.vibecoden.yml reicht es durch). Shotcut und melt aus
# Debian (GPL-3.0+, MLT LGPL-2.1+; eigene Programme, nur in den Sandboxen), mit Qt einige hundert MB – zeigt main.mlt im Bild
# (Shotcut im großen, melt im kleinen), melt rendert im Terminal des Motors.
ARG SHOTCUT=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$SHOTCUT" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends shotcut melt && rm -rf /var/lib/apt/lists/*; \
    fi

# Partituren im Bild (VKk4i) – nur mit VIBECODEN=1 und MUSESCORE=1 (docker-compose.vibecoden.yml reicht es durch). MuseScore 3 aus
# Debian (GPL-2.0, Klangbibliothek MIT; eigenes Programm, nur in den Sandboxen), mit Qt rund 100 MB – zeigt main.mscx im Bild,
# wandelt MusicXML um und gibt PDF, MIDI und WAV im Terminal des Motors aus.
ARG MUSESCORE=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$MUSESCORE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends musescore3 && rm -rf /var/lib/apt/lists/*; \
    fi

# Gemälde im Bild (VKk4j) – nur mit VIBECODEN=1 und KRITA=1 (docker-compose.vibecoden.yml reicht es durch). Krita aus Debian
# (GPL-3.0+, eigenes Programm, nur in den Sandboxen), mit Qt und KDE Frameworks rund 300 MB – zeigt main.kra und main.ora im Bild.
ARG KRITA=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$KRITA" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends krita && rm -rf /var/lib/apt/lists/*; \
    fi

# CAD-Zeichnungen im Bild (VKk4k) – nur mit VIBECODEN=1 und LIBRECAD=1 (docker-compose.vibecoden.yml reicht es durch). LibreCAD aus
# Debian (GPL-2+, eigenes Programm, nur in den Sandboxen), rund 70 MB – zeigt main.dxf im Bild und gibt sie im Terminal als PDF aus.
ARG LIBRECAD=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$LIBRECAD" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends librecad && rm -rf /var/lib/apt/lists/*; \
    fi

# Layouts im Bild (VKk4l) – nur mit VIBECODEN=1 und SCRIBUS=1 (docker-compose.vibecoden.yml reicht es durch). Scribus aus Debian
# (GPL-2+, eigenes Programm, nur in den Sandboxen), rund 130 MB – zeigt main.sla im Bild.
ARG SCRIBUS=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$SCRIBUS" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends scribus && rm -rf /var/lib/apt/lists/*; \
    fi

# Karten für 2D-Spiele im Bild (VKk4m) – nur mit VIBECODEN=1 und TILED=1 (docker-compose.vibecoden.yml reicht es durch). Tiled aus
# Debian (GPL-2+, eigenes Programm, nur in den Sandboxen), mit Qt 5 rund 50 MB – zeigt main.tmx im Bild und gibt sie im Terminal
# für Spiele-Engines aus (JSON, Lua).
ARG TILED=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$TILED" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends tiled && rm -rf /var/lib/apt/lists/*; \
    fi

# Java-Projekte mit Gradle (VKh2a) – nur mit VIBECODEN=1 und GRADLE=1 (docker-compose.vibecoden.yml reicht es durch). Das JDK 17
# aus Debian (GPL-2.0 mit Classpath-Ausnahme, eigenes Programm, nur in den Sandboxen), rund 250 MB; Gradle kommt aus der Stufe
# oben. Die Konfiguration des JDK liegt unter /etc/java-17-openjdk – die Sandbox liest sie (VKh1). Die slim-Bilder haben kein
# /usr/share/man/man1, ohne den Ordner scheitert die Installation des JDK.
ARG GRADLE=0
RUN if [ "$VIBECODEN" = "1" ] && [ "$GRADLE" = "1" ]; then \
      mkdir -p /usr/share/man/man1 && apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
      && rm -rf /var/lib/apt/lists/*; \
    fi
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
