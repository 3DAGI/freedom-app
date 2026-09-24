# Freedomstack Roadmap — offene Protocol/Produkt-Entscheidungen

*Notiert aus Strategie-Gesprächen. Diese Punkte sind vor Launch zwingend.*

## R1: Wallet-Pflicht statt walletloser Dauerzustand

**Status:** offen · **Priorität:** hoch (Launch-Blocker)

Der Gate-Button „continue without wallet (local, free)" ist eine Dev-Krutch.
Vor dem Launch entfernen und ersetzen durch:

```
Gate:  [BTC] Mit Lightning starten   [SOL] Mit Solana starten
       → beide Wege führen ins Wallet-Setup
       → danach X gratis tokens als Willkommensguthaben
         (an pubkey + verifizierte Wallet-Adresse gebunden)
```

Gratis-Tokens gibt es NACH Wallet-Connect als Provider-Bonus, nicht als
walletloser Dauerzustand.

## R2: Session-Budget nur gegen echtes Guthaben

**Status:** offen · **Priorität:** hoch (Anti-Sybil, Launch-Blocker)

Aktuell: `openSession` gibt jedem neuen Pubkey 100 sats „auf Kredit"
(`defaultBudgetSats: 100`). Pubkeys sind gratis → Free-Riding via neue
Accounts ist trivial.

Fix (Non-Custodial-Reihenfolge):
1. Nutzer verbindet Wallet / zahlt SOL-Deposit ins Escrow
2. `openSession` wird ERST nach bestätigtem Deposit erlaubt
   (`depositConfirmed` als Vorbedingung)
3. Budget der Session = Deposit-Höhe; Jobs ziehen vom Escrow ab
4. Ohne Deposit: nur Tages-Gratis-Kontingent (5.000 tokens), kein Session-Kredit

Betrifft: `packages/app/src/session-client.ts` (`openSession`),
`packages/node/src/dvm-provider.ts` (`validateSession`).

## R3: Open-Source-Release Vorbereitung

**Status:** offen · **Priorität:** mittel

Repo liegt NUR lokal auf der GX10 (kein remote). Vor GitHub-Publish:
- [ ] Security-Audit (Phase 1.5): Secrets in History? env-Beispiele sauber?
- [ ] Lizenz entscheiden (MIT / AGPL / BSL)
- [ ] README + Quickstart für Provider & Nutzer
- [ ] CI-Build (App + Node)

## Fokus-Entscheidung (bestätigt)

Freedom = **Marktplatz für dezentrale KI-Arbeit**:
- 70% KI mieten (Client/Agent-UX)
- 20% Compute vermieten (Provider-Onboarding)
- 10% Agent-Workflows (Multi-Step-Chains über Provider) — Wachstumsfeld

Kommunikation (Feed/DMs): eingefroren, läuft, keine weitere Entwicklungszeit.
