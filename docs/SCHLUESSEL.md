# Schlüssel und Ableitungspfade

Alle dauerhaften Schlüssel entstehen aus derselben 12-Wort-Phrase (BIP-39).
Jeder Schlüssel hat genau einen Zweck.

| Zweck | Pfad | Verfahren | Wo im Code |
|---|---|---|---|
| Nostr-Identität | `m/44'/1237'/0'/0/0` | BIP-32, secp256k1 (NIP-06) | `packages/app/src/identity.ts` |
| Solana-Wallet | `m/44'/501'/0'/0'` | SLIP-10, Ed25519 – wie Phantom/Solflare | `packages/protocol/src/derivation.ts` (`deriveSolanaKey(seed, 0)`) |
| Solana-Zahladressen | `m/44'/501'/n'/0'` | SLIP-10, Ed25519 | `deriveSolanaKey(seed, n)` |
| Sicherung und lokale Verschlüsselung | eigener Pfad | siehe `state-backup.ts` | nie derselbe Schlüssel wie zum Signieren |
| KI-Sitzungen | – | zufällig, nicht aus der Phrase | bewusst unverknüpfbar (Phase 3) |

Ed25519 erlaubt nach SLIP-10 nur gehärtete Ableitung. Deshalb kann niemand aus
einem öffentlichen Schlüssel fremde Adressen ableiten: Wer Geld empfangen will,
erzeugt jede Adresse selbst und schickt sie verschlüsselt mit.

**Offen (MENSCH):** Eine reine Test-Phrase in Phantom importieren und prüfen,
dass die angezeigte Adresse zu `deriveSolanaKey(seed, 0)` passt. Die Adresse
dann als Erwartungswert in `test/derivation.test.ts` eintragen.

## Aufbewahrung auf dem Gerät (Schritt 1.2)

| Zustand | Wo der Nostr-Schlüssel liegt |
|---|---|
| ohne Tresor | `localStorage` (`freedom.nsec`), unverschlüsselt – wie bisher |
| mit Tresor | IndexedDB `freedom-vault`, AES-GCM 256; Schlüssel aus der Passphrase per PBKDF2-SHA256 mit 600.000 Iterationen (`packages/app/src/vault.ts`) |

Den Tresor richtet man nach der ersten Nutzung ein (Settings → Sicherheit,
Schritt 5, oder über die Führung); danach fragt die App bei jedem Start nach der
Passphrase. Die Tresor-Passphrase ist **keine** BIP-39-Passphrase: Sie ändert
keinen Pfad und keinen Schlüssel. Wer sie vergisst, stellt die Identität mit den
12 Wörtern (oder dem nsec) wieder her und legt dabei einen neuen Tresor an.
