# Versiegelter Provider-Modus – Entwurf (D3)

Stand 06.10.2026, Spur A. **Vorlage zur Freigabe durch den MENSCHEN.** Gebaut
wird davon erst nach der Freigabe. Grundlage ist der Plan vom 05.10.2026
(Sammlung D1, Karte `docs/DATENSCHUTZ-PROVIDER.md`, Abschnitt 4): Stufe 1
(Platzhalter, Schlüssel je Unterhaltung, weniger Verlauf) und Stufe 2
(Privat-Schalter) sind gebaut (D1a–D1c, D2). Stufe 3 ist dieser Entwurf.

Freizugeben sind die Vorschläge V1–V7 und die Antworten auf die Fragen F1–F5
am Ende. „Wie vorgeschlagen“ genügt; jede Frage lässt sich einzeln anders
entscheiden. F1 und F2 sind Messungen am GX10, ohne sie bleibt offen, ob GB10
überhaupt mitmacht.

## Worum es geht

Der Provider muss die Frage im Klartext rechnen. Auf DGX Spark/GB10, Macs und
Gaming-PCs gibt es kein TEE, das ihn am Mitlesen hindert. Heute verlässt sich
die App darauf, dass der Knoten nichts mitschreibt (3.3, `klartext.test.ts`) –
prüfen kann sie es nicht: Der Betreiber kann den Knoten ändern, einen anderen
Inferenz-Server davorschalten oder Protokolle einschalten.

Der versiegelte Modus soll belegen, **welche Software gestartet wurde**: ein
festes, reproduzierbar gebautes Image ohne Fernzugang, dessen Knoten und
Inferenz-Server nichts mitschreiben. Die App prüft den Beleg, bevor sie fragt.

## Was es heute gibt

| Baustein | Stand | Wo |
|---|---|---|
| Reproduzierbarer Build | Nur die App (`freedom.html`, `freedom-sw.js`): zwei Builds an zwei Pfaden, eine Summe. Für den Knoten gibt es Installer und Docker, kein festes Image. | `scripts/repro-build.sh`, 5.9a |
| Release-Manifest | Kind 38054, k-von-n signiert (5.2); die Liste der Signierer ist leer bis MENSCH. | `release.ts`, `release-signierer.ts` |
| Kein Klartext im Knoten | Regel und Test für den eigenen Code – nicht für den Inferenz-Server (Ollama, llama.cpp, vLLM) und nicht für das Betriebssystem. | `node/test/klartext.test.ts` |
| Versiegelte Anfragen | Frage, Antwort, Sitzung und Belege nur im Umschlag an den Schlüssel des Providers (3.1–3.2). Wer den Schlüssel hat, liest. | `private-job.ts` |
| Angebot | Kind 38027, signiert vom Schlüssel des Providers. | `discovery.ts` |

## Bedrohungsmodell – was der Modus leistet und was nicht

**Leistet** (wenn alles wie unten gebaut ist):
- **Software-Mitschnitt:** Die App erkennt einen Knoten, der nicht das
  veröffentlichte Image gestartet hat – geänderter Knoten, zusätzliches
  Logging, anderer Kernel, Fernzugang.
- **Spätere Entschlüsselung:** Mit V7 liegt der Schlüssel des Providers
  versiegelt im TPM. Startet der Betreiber etwas anderes, gibt das TPM ihn
  nicht heraus – mitgeschnittene Umschläge kann er dann nicht öffnen.

**Leistet nicht** (das muss jeder Text sagen):
- **Physischer Zugriff:** Wer am Gerät sitzt, kann den Arbeitsspeicher und den
  Speicher der GPU auslesen (Kälte-Angriff, DMA, Bus mitlesen). Der GB10 hat
  gemeinsamen Speicher für CPU und GPU und kein Confidential Computing; das
  gibt es bei NVIDIA bisher nur für Rechenzentrums-GPUs.
- **Angriffe auf das TPM:** Ein separates TPM-Bauteil (dTPM) lässt sich am Bus
  belauschen oder zurücksetzen, Firmware-TPMs (fTPM) hatten Schwachstellen.
  Der Beleg ist so gut wie das TPM.
- **Fehler im Image:** Belegt wird, *dass* das veröffentlichte Image läuft,
  nicht, dass es fehlerfrei ist. Deshalb reproduzierbar und offen.
- **Macs:** keine Attestierung, die einem fremden Prüfer belegt, welches
  System gestartet wurde (App Attest belegt nur, dass eine echte, signierte
  App läuft – nicht, was sonst auf dem Rechner läuft). Macs bleiben ohne Siegel.

Ein ehrlicher Satz für die App wäre: „Versiegelt: Dieser Provider hat belegt,
dass sein Rechner die veröffentlichte Software gestartet hat, die nichts
mitschreibt. Wer am Gerät sitzt, kann den Speicher trotzdem auslesen.“

## Wie es funktioniert

1. **Image:** ein festes Betriebssystem-Image mit Knoten, Inferenz-Server und
   GPU-Treiber, reproduzierbar gebaut (V1). Kernel, Initrd und Befehlszeile
   als ein signiertes Kernel-Image (UKI); das Wurzeldateisystem nur lesbar,
   jede Seite gegen einen Hash geprüft (dm-verity), der Hash steht in der
   Befehlszeile. Kein SSH, keine Paketverwaltung zur Laufzeit.
2. **Gemessener Start:** Secure Boot startet nur signierte Teile; die
   Firmware und der Lader schreiben Prüfsummen in die PCR-Register des TPM.
   Was gestartet wurde, steht danach unveränderlich in PCR 7 (Secure-Boot-Stand)
   und PCR 11 (das Kernel-Image samt Wurzel-Hash) (V2).
3. **Schlüssel:** Beim ersten Start im Image erzeugt der Knoten seinen
   Provider-Schlüssel und legt ihn versiegelt im TPM ab – nur mit genau diesen
   PCR-Werten wieder lesbar (V7). Dazu ein Attestierungsschlüssel (AK) im TPM,
   gebunden an den Endorsement-Schlüssel (EK) des Herstellers (V3).
4. **Beleg:** Die App schickt versiegelt eine Zufallszahl (neues Kind, Vorschlag
   5080). Der Knoten antwortet mit einem TPM-Quote: die PCR-Werte, signiert
   vom AK, mit Zufallszahl und Provider-Schlüssel im signierten Teil
   (`qualifyingData`). So ist der Beleg frisch und gehört genau zu dem Schlüssel,
   an den die App ihre Fragen versiegelt.
5. **Prüfung in der App:** Signatur des Quotes, AK gehört zu einem echten TPM
   (Zertifikatskette des Herstellers, V3–V5), PCR-Werte gleich den Werten im
   signierten Release-Manifest des Images (38054), Zufallszahl und Schlüssel
   passen. Erst dann zählt der Provider als versiegelt (V6).

## Vorschläge

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| V1 | Wie entsteht das Image? | A mkosi (systemd), Pakete aus einem festen Ubuntu-Stand mit Prüfsummen, nah an DGX OS · B NixOS (am besten reproduzierbar, GB10-Treiber und CUDA dort ungewiss) · C Docker-Image (kein gemessener Start – reicht nicht) | A – der GPU-Treiber für GB10 kommt aus dem DGX-OS-Stapel |
| V2 | Welche PCR zählen? | A PCR 7 und 11 (unabhängig von der Firmware des Modells) · B PCR 0–7 und 11 (dazu Firmware – je Gerätemodell eigene Sollwerte) | A – sonst bräuchte jedes OEM-Modell eigene Werte |
| V3 | Wie beweist der AK, dass er in einem echten TPM liegt? | A einmal je Provider „Credential Activation“ (die App verschlüsselt ein Geheimnis an den EK, nur das TPM mit diesem EK kann es öffnen) plus Zertifikatskette des EK zum Hersteller · B Vertrauen beim ersten Sehen, ohne Hersteller | A – ohne Hersteller-Kette könnte ein Software-TPM (swtpm) alles belegen |
| V4 | Zertifikate lesen (DER/X.509) | A eigener kleiner Leser ohne Abhängigkeit, mit Grenzen wie `git-bundle.ts` und `ots.ts` · B Abhängigkeit (`@peculiar/x509` o. ä.) | A – neue Abhängigkeiten nur nach Rückfrage, und der Leser braucht nur einen kleinen Teil |
| V5 | Wer pflegt die Wurzeln der TPM-Hersteller? | A Liste im Code, geändert nur mit signiertem Release (wie `TRUSTED_SIGNERS`), leer bis MENSCH · B automatisch aus dem Netz | A |
| V6 | Was macht die App mit „versiegelt“? | A Abzeichen bei der Auswahl und eine dritte Stufe beim Privat-Schalter: „privat“ (Gerät, eigener Knoten) · „versiegelt“ (dazu nur versiegelte Provider) · B nur ein Abzeichen | A – die Stufe folgt der Regel aus D2: nie still ausweichen |
| V7 | Provider-Schlüssel an die PCR binden? | A ja – außerhalb des Images unbrauchbar · B nein, nur Beleg | A – sonst könnte der Betreiber Umschläge mitschneiden und später mit einem anderen System öffnen |

## Fragen an den MENSCHEN

- **F1:** Hat der GX10 ein TPM? Auf dem GX10 `ls /dev/tpm*` ausführen und das
  Ergebnis nennen (erwartet: `/dev/tpm0 /dev/tpmrm0`). Ohne TPM kein Siegel
  auf GB10.
- **F2:** Ist Secure Boot an? `mokutil --sb-state` ausführen und das Ergebnis
  nennen. Dazu, wenn `tpm2-tools` installiert sind: `sudo tpm2_nvread
  0x01c00002 -o ek.der && openssl x509 -inform der -in ek.der -noout -issuer`
  (wer das EK-Zertifikat ausgestellt hat – das ist die Wurzel für V5; bei
  ECC-Schlüsseln `0x01c0000a`). Fehlt das Zertifikat, ist das auch eine Antwort.
- **F3:** Wer signiert die Image-Releases? Vorschlag: dieselben k-von-n
  Signierer wie für die App (5.2, `TRUSTED_SIGNERS`).
- **F4:** Versiegelte Knoten haben keinen Fernzugang. Fehler suchen geht nur
  über den Status (B-11), Updates nur über ein neues signiertes Image.
  Einverstanden?
- **F5:** Soll das Siegel bei der Auswahl Vorrang geben (wie eigene Provider)
  oder nur für die Stufe „versiegelt“ zählen? Vorschlag: nur für die Stufe –
  sonst lohnt es sich, ein Siegel vorzutäuschen, und Macs wären benachteiligt.

## Schritte nach der Freigabe

Je Schritt höchstens etwa 400 geänderte Zeilen.

| Schritt | Inhalt |
|---|---|
| D3a | Protokoll: TPM-Strukturen lesen (`TPMS_ATTEST`, `TPMT_SIGNATURE`), Quote prüfen (Signatur, PCR-Digest, `qualifyingData`), Anfrage und Antwort versiegelt (Kind-Vorschlag 5080); Testvektoren nur mit einem Skript aus `swtpm` und `tpm2-tools` erzeugt (wie `ots-referenz.py`) |
| D3b | DER/X.509-Leser (V4) und Credential Activation (V3), Wurzelliste leer bis MENSCH (V5) |
| D3c | Knoten: Rolle „versiegelt“ – AK anlegen, Quote, Schlüssel an PCR (V7) über `tpm2-tools` als Kindprozess (keine npm-Abhängigkeit); Selbstprüfung in `pruefeEinrichtung()` |
| D3d | Image: mkosi-Rezept (V1), reproduzierbar mit Prüfung wie `repro-build.sh`, Sollwerte für PCR 7 und 11 im Release-Manifest |
| D3e | App: Prüfung, Abzeichen, Stufe „versiegelt“ (V6); Datenschutz-Aussage „versiegelt“ als Grenze (physischer Zugriff, TPM-Angriffe); Website |
| D3f | MENSCH: Image auf dem GX10 starten, Beleg aus der Live-App prüfen |

Bis zur Freigabe ändert sich am Code nichts. Die Karte nennt D3 als
„Entwurf fertig, wartet auf Freigabe“.
