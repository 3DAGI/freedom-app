# Provider-Knoten.
#
# Bewusst schlank: Playwright ist eine OPTIONALE Abhaengigkeit (~300 MB inkl.
# Browser) und wird hier nicht installiert. Wer Browser-Automatisierung
# braucht, baut ein eigenes Image — dem Normalfall diese Groesse aufzuzwingen
# waere der falsche Standardfall.
FROM node:22-slim

# Nicht als root laufen. Der Knoten verarbeitet fremde Prompts; alles, was den
# Rechteumfang begrenzt, ist hier eine Investition.
RUN useradd -m -u 1001 -s /bin/bash freedom || true
WORKDIR /app

# Erst die Manifeste kopieren: So bleibt der Installationsschritt im Cache,
# solange sich nur der Quelltext aendert.
COPY package.json package-lock.json* ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/node/package.json packages/node/

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --workspaces --include-workspace-root \
      --no-audit --no-fund --omit=optional \
    || npm install --no-audit --no-fund --omit=optional

COPY packages/protocol packages/protocol
COPY packages/node packages/node

RUN mkdir -p /home/node/.freedom /home/node/freedom-data \
    && chown -R freedom:freedom /app /home/node
USER freedom
ENV HOME=/home/node

WORKDIR /app/packages/node

# Startet nur mit gesetzter Auszahlungsadresse — main.ts bricht sonst mit
# einer klaren Meldung ab.
CMD ["node", "--import", "tsx", "src/main.ts"]
