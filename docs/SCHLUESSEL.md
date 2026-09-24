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
