# Protokoll (`packages/protocol`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter
`packages/protocol/` gelesen wird. Hier steht, was man nur in den Protokollbausteinen
falsch macht – verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag
mit „Weitere Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue
Fallstricke dieses Bereichs unten anhängen.

## Fallstricke

- **Kopfgelder nur über `kopfgeld.ts`** (seit E10a, Kind 38061): zugesagt in
  sats und/oder SOL, gebaut nur über `baueKopfgeld()`, gelesen nur über
  `leseKopfgeld()`/`aktuelleKopfgelder()` – der Stand gilt je Geldgeber und
  Kennung, nie nach der Kennung allein (sonst meldet ein Fremder ein Kopfgeld
  als erledigt). Bezahlt wird direkt vom Geldgeber an den Erlediger – kein
  Topf, keine Runde, nichts verwahrt (38059/38060 nicht wiederverwenden).
- **OpenTimestamps nur über `ots.ts`** (seit B-17a, 5.10b): Beweise lesen und
  schreiben nur mit `leseOtsDatei()`/`leseOtsZeitstempel()` und
  `schreibeOtsDatei()`/`schreibeOtsZeitstempel()` – Format wie python-opentimestamps, Grenzen
  aus `OTS_GRENZEN`, Fehler nur als `OtsFehler`-Kennung (nie Text aus dem Beweis). Bündeln
  nur über `buendele()` (je Wert eine Zufallszahl wie der ots-Client – der Kalender lernt
  keinen Wert), Kalender-Antworten nur über `fuegeEin()`. Eine ausstehende Attestierung ist
  nur ein Versprechen; „in Bitcoin verankert“ heißt erst, dass der Endwert der Merkle-Wurzel
  des Blocks gleicht – nie aus dem Beweis allein behaupten. Testvektoren nur mit
  `scripts/ots-referenz.py` neu erzeugen; die LGPL-Beispieldateien der Referenz nicht ins Repo.
  Kalender (seit B-17b1, K5 A) nur über `stempele()`/`reicheNach()` (`ots-kalender.ts`): gefragt
  wird nur `OTS_KALENDER`, nie eine Adresse aus einem Beweis; ein Stempel braucht zwei Antworten.
  Anfragen ohne Content-Type – die Kalender erlauben jede Herkunft, beantworten aber keinen
  Preflight. NIP-03 (Kind 1040) nur über `baueOtsBeweis()` (nur Bitcoin, `nurBitcoin()`) und
  `leseOtsBeweis()`; eine Höhe darin ist ungeprüft, bis der Blockkopf passt (B-17b2).
  „Verankert“ (seit B-17b2, K4 A) nur über `pruefeVerankerung()` (`ots-bitcoin.ts`): Blockkopf
  von beiden Explorern aus `OTS_EXPLORER`, nur gleich gilt er, und er prüft sich selbst
  (`leseBlockkopf()`: Hash gleich dem genannten, Arbeit, Ziel des Hauptnetzes). Fehlt einer oder
  sind sie uneinig: keine Aussage – nie auf einen Explorer allein ausweichen. Gefragt nur bei
  Bedarf; die Explorer sehen IP und Höhe. Node-`fetch` nutzt den Agent-Proxy nur mit
  `NODE_USE_ENV_PROXY=1` (und `NODE_EXTRA_CA_CERTS`) – Live-Proben sonst „nicht-erreichbar“.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Agenten in Räumen nur über `agent-karte.ts`** (seit 11.3b1, `docs/PROTOCOL.md` 32): Karte (38090)
  nur über `baueAgentKarte()`/`raumAgentKarte()`, gelesen nur über `leseAgentKarte()`/`aktuelleAgentKarten()`
  bzw. `raumAgentKarten()` (streng, je Agent die neueste); Autor ist immer der Agent, nie sein Ersteller.
  Einen Besitzer nur über `besitzerBestaetigt()` zeigen – die Karte allein behauptet ihn nur. Die Rolle nur
  über `mitAgentRolle()` (Grundrechte, Rang 1), nie mit Moderieren oder Vergeben. In privaten Räumen Karte und
  Liste nur als innere Events – Leak-Regel `agent-raum-privat`. Keine Persona und keine Systemanweisung in
  die Karte (F4 A).
