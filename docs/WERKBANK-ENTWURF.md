# Entwurf: Werkbank-Knoten – weitere eigene Rechner als Hände des Agenten (VKj)

Stand 23.10.2026, Spur A. `docs/VIBECODEN-ENTWURF.md`, VK-W7 **A** (14.10.2026): „Werkbank-Knoten: weitere eigene
Rechner per QR für Programme ohne ARM64“. Erst ein Entwurf mit Befunden und Fragen; gebaut wird nach Freigabe – das
Format der Nachrichten zwischen den Knoten ist neu (STOPP-Regel „Event-Formate“).

## Ausgangslage

- **Der Agent arbeitet auf dem GX10** (VKc–VKd): Hermes in der Sandbox ohne Netz; Werkzeuge über Freedom-MCP an der
  Brücke (`/mcp/<zeichen>` je Projekt, VKd2b1), Browser und Kiwix als Kinder des Motors (VKk1, VKd2a), Bilder über die
  eigene ComfyUI (VKd2b2), Vorschau über eine eigene Adresse (VKg1) oder als Bildstrom über den eigenen TURN (VKg2).
- **Was auf ARM64 nicht geht** (Entwurf, Abschnitt Programme): Unity, Unreal, DaVinci Resolve und Ableton haben keinen
  Editor für Linux ARM64; iOS braucht einen Mac. Für alle gibt es MCP-Server (`CoplayDev/unity-mcp` MIT,
  `chongdashu/unreal-mcp`, `ahujasid/ableton-mcp` MIT, …).
- **Kopplung gibt es** (B-8, `kopplung.ts`): Ein Knoten zeigt einen Kopplungscode (QR), die App legt das Geheimnis im
  Tresor ab; Anfragen tragen nur einen Nachweis (HMAC) im versiegelten Kern. Code zum Eintippen seit VKf.
- **Der Knoten läuft heute nur unter Linux** – die Sandbox ist bubblewrap. Ein Windows- oder Mac-Rechner hat keine.

## Befunde

- **ContextVM** ist ein offenes Format für MCP über Nostr (contextvm.org): jede MCP-Nachricht ein Event der Art
  `25910` (flüchtig, 20000–29999), Empfänger im `p`-Tag, Antwort über `e` an die Id der Anfrage.
  - CEP-4 (endgültig): Ende-zu-Ende über NIP-59 – das Event der Art 25910 im Umschlag 1059, wahlweise 21059 (flüchtiger
    Umschlag, CEP-19); offen steht nur der Empfänger.
  - CEP-22 (Entwurf): große Nachrichten in Stücken über MCP-Fortschrittsmeldungen, mit SHA-256 über das Ganze – Relays
    nehmen meist nur rund 64 KiB je Event, ein Bildschirmfoto ist größer.
  - Das SDK (`@contextvm/sdk`) steht unter LGPL-3.0/GPL-3.0 – als Abhängigkeit nicht passend (seit LIZ: EUPL-1.2, starkes
    Copyleft nur als eigenes Programm). Das Format selbst lässt sich ohne Abhängigkeit bauen, wie Cashu (RM2) oder
    Meshtastic (7.5).
- **Umschläge können wir schon** (`gift-wrap`, 3.1–3.4), ebenso den Aufbau eines direkten Kanals über den eigenen TURN
  (B-13c: Angebot nur mit Relay-Kandidaten) und den Bildstrom (VKg2).
- **Auf der Werkbank gibt es keine Sandbox** wie auf dem GX10: Ein MCP-Server für Unity führt dort Befehle im Editor
  aus, also Code auf dem Rechner.

## Vorschlag

Eine **Werkbank** ist ein schlanker Freedom-Knoten (`npm run werkbank`, Node.js, auch unter Windows und macOS):
eigener Schlüssel, Verbindung zu den Relays, MCP-Server aus `~/.freedom/werkbank.json` (wie `mcp.json`, je Server eine
Liste erlaubter Werkzeuge). Kein KI-Antrieb, kein Angebot, keine Zahlungen.

1. **Koppeln:** Die Werkbank zeigt einen Kopplungscode (QR oder zum Eintippen). Die App des Besitzers liest ihn und
   sagt dem eigenen GX10 versiegelt, welche Werkbank ihm gehört (Code-Aktion mit Besitzer-Nachweis). Die Werkbank
   nimmt danach nur Nachrichten vom Schlüssel dieses GX10 an.
2. **Bedienen:** Der GX10 spricht MCP mit der Werkbank im Format von ContextVM, nur versiegelt (CEP-4). Hermes sieht die
   Werkzeuge der Werkbank als weiteren Server an der Brücke (`/mcp/<zeichen>/werkbank`), mit Namen wie `werkbank_unity_…`.
3. **Freigeben:** Werkzeuge der Werkbank laufen ohne Sandbox. Sie gelten deshalb wie Befehle: Im Modus „fragen“ fragt
   die App vorher (VKa), auch wenn Hermes selbst nicht fragt.
4. **Vorschau:** Die Werkbank sendet ihren Bildschirm wie VKg2 über den eigenen TURN aufs Handy (später, eigener Teil).
5. **Ehrlich ohne Werkbank:** Fehlt sie, sagt Freedom-MCP dem Agenten, welche Programme nur dort laufen.

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| VKj-W1 | Wie reden GX10 und Werkbank? | **A** ContextVM-Format (25910 im Umschlag, CEP-4), selbst gebaut, über die Relays · **B** eigenes Format über einen direkten Kanal (WebRTC über den eigenen TURN) · **C** Tor-Dienst auf der Werkbank | **A** – offener Standard, keine Abhängigkeit, durch jedes NAT; große Antworten nach CEP-22 in Stücken; der direkte Kanal (B) nur für die Vorschau |
| VKj-W2 | Wer koppelt die Werkbank mit dem GX10? | **A** der Besitzer mit dem Handy (Code der Werkbank in der App, versiegelt an den GX10) · **B** die Werkbank direkt mit einem Code des GX10 | **A** – das Handy ist schon der Schlüssel für beide; die Werkbank kennt nur den GX10 |
| VKj-W3 | Was darf der Agent auf der Werkbank ohne Rückfrage? | **A** nur Werkzeuge aus der Liste in `werkbank.json`, alle wie Befehle (fragen im Modus „fragen“) · **B** lesen ohne Frage (Bildschirmfoto, Zustand), ändern mit Frage · **C** alles aus der Liste ohne Frage | **B** – sehen ist harmlos, ändern führt Code auf dem Rechner aus |
| VKj-W4 | Womit anfangen? | **A** Unity unter Windows (`unity-mcp`, MIT) · **B** Xcode und iOS auf dem Mac · **C** Android Studio auf x86-Linux | **A** – größter Bedarf, MCP-Server fertig, Lizenz passt |

## Aufteilung (nach Freigabe, Empfehlungen)

| Teil | Inhalt | Umfang |
|---|---|---|
| VKj1 | Protokoll: ContextVM-Nachrichten im Umschlag bauen und lesen (25910, 1059/21059), Stückelung nach CEP-22, Vektoren | ~250 |
| VKj2 | Werkbank: `npm run werkbank`, Schlüssel, Kopplungscode, MCP-Server aus `werkbank.json`, nur Nachrichten des gekoppelten GX10 | ~350 |
| VKj3 | GX10: Werkbank kennen (Code-Aktion), ihre Werkzeuge an der Brücke, Freigaben nach VKj-W3 | ~300 |
| VKj4 | App: Werkbank koppeln (QR oder Code), Liste der Werkbänke im Blatt „Mein Knoten“ (mit Spur C) | ~250 |
| VKj5 | Vorschau von der Werkbank (Bildstrom wie VKg2, unter Windows mit eigenem Aufnehmer) | ~400 |

## Quellen

- ContextVM: https://contextvm.org, Spezifikation https://docs.contextvm.org/reference/spec/ctxvm-draft-spec/
- CEP-4 Encryption Support: https://docs.contextvm.org/reference/ceps/cep-4/
- CEP-22 Oversized Payload Transfer: https://docs.contextvm.org/reference/ceps/cep-22/
- SDK und Lizenz: https://github.com/contextvm/ts-sdk (LGPL-3.0, GPL-3.0)
