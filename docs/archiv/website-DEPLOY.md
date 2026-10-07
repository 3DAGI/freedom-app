# freedom website — dezentrales Hosting

Drei Schichten, damit die Seite unkaputtbar bleibt. Reihenfolge: IPFS (primär),
Tor (privat + fallback), ENS (Name). Arweave optional als Perma-Backup.

---

## 1. IPFS (primär)

```bash
# Kubo installieren (einmalig)
# https://docs.ipfs.tech/install/command-line/
ipfs init
ipfs daemon &   # laeuft dauerhaft

# Website pinnen
cd /home/ai_3dnono/freedomstack
ipfs add -r packages/website
# -> letzte Zeile: "added QmXXXX... website"
CID=QmXXXX...
ipfs pin add $CID
ipfs name publish $CID   # IPNS: stabiler Name bei Updates

# Oeffentlich erreichbar ueber JEDEN Gateway:
#   https://ipfs.io/ipfs/$CID
#   https://dweb.link/ipfs/$CID
#   https://cloudflare-ipfs.com/ipfs/$CID
#   https://$CID.ipfs.localhost:8080  (lokal)
```

**Wichtig:** Solange DEIN Node pinnt + laeuft, ist die Seite erreichbar, auch
wenn alle oeffentlichen Gateways sperren. Zusaetzlich:
- Pinning-Service als Backup (web3.storage / Pinata — nur Email nötig)
- Jeder User/Supporter kann `ipfs pin add $CID` — die Seite lebt dann auf
  deren Rechnern weiter (wie Radicle fuer Code, aber fuer die Website)

---

## 2. Tor Onion Service (privat + fallback, laeuft auf der GX10)

```bash
sudo apt install tor
sudo tee -a /etc/tor/torrc <<'EOF'
HiddenServiceDir /var/lib/tor/freedom-website/
HiddenServicePort 80 127.0.0.1:3600
EOF
sudo systemctl restart tor
sudo cat /var/lib/tor/freedom-website/hostname   # -> deine .onion-Adresse

# Website lokal servieren
cd /home/ai_3dnono/freedomstack/packages/website
python3 -m http.server 3600 --bind 127.0.0.1
```

Kein DNS, kein Registrar, kein Provider — nur du. Erreichbar ueber Tor Browser.
Die .onion-Adresse in die Download-Sektion der Website eintragen.

---

## 3. ENS (unkaputtbarer Name) — optional

`freedomstack.eth` registrieren (Ethereum, ~$5/Jahr in ETH, kein KYC):
- ENS-Record `contenthash` -> IPFS CID/IPNS
- User mit ENS-faehigem Browser/Resolver: `freedomstack.eth` laedt von IPFS
- Alternativ `freedomstack.eth.limo` (faehiger Gateway, kein Plugin nötig)

**Bequemlichkeits-Domain (Marketing-Huelle):** klassische .com bei Njalla
(zahlt BTC, kein KYC) -> zeigt auf IPFS-Gateway. Wird sie genommen,
zeigt ENS/Community auf den CID — die Seite selbst geht nie offline.

---

## 4. Arweave (perma-backup, einmal zahlen)

```bash
npm i -g arkb
# Wallet mit etwas AR aufladen (via DEX, kein KYC nötig)
arkb deploy packages/website --wallet arweave-key.json
# -> ar://<tx-id>, fuer immer online, viele Gateways (arweave.net, ar.io, g8way)
```

---

## Deployment-Reihenfolge

1. `bash packages/website/build.sh`  (App + Hashes)
2. `ipfs add -r packages/website` + pin + IPNS publish
3. Tor-Onion einrichten (s.o.)
4. CID + Onion in `index.html` (Download-Sektion) eintragen
5. Optional: ENS + Arweave
