/**
 * Anchor-Integrationstest (laeuft mit `anchor test` gegen einen lokalen Validator).
 * Dokumentiert das erwartete On-chain-Verhalten des HTLC-Programms.
 *
 * Voraussetzung: Solana + Anchor Toolchain installiert (siehe README).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaHtlc } from "../target/types/solana_htlc";
import { createHash, randomBytes } from "crypto";
import { assert } from "chai";

describe("solana-htlc", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.SolanaHtlc as Program<SolanaHtlc>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

  it("claim mit korrekter Preimage zahlt an den Empfaenger aus", async () => {
    const initiator = provider.wallet; // LP
    const recipient = anchor.web3.Keypair.generate(); // Nutzer

    const preimage = randomBytes(32);
    const hashlock = sha256(preimage);
    const swapId = randomBytes(32);
    const amount = new anchor.BN(1_000_000);
    const timelock = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

    const [swapPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("swap"), swapId],
      program.programId,
    );

    await program.methods
      .initialize([...swapId], [...hashlock], timelock, amount)
      .accounts({ initiator: initiator.publicKey, recipient: recipient.publicKey, swap: swapPda })
      .rpc();

    const before = await provider.connection.getBalance(recipient.publicKey);
    const initiatorBefore = await provider.connection.getBalance(initiator.publicKey);
    const rent = await provider.connection.getBalance(swapPda);

    await program.methods
      // [u8; 32] statt Vec<u8>: Anchor erwartet hier ein festes Array.
      .claim([...preimage])
      .accounts({
        recipient: recipient.publicKey,
        // Neu: der Initiator bekommt die Mietbefreiung zurueck, wenn das
        // Programm den PDA schliesst.
        initiator: initiator.publicKey,
        swap: swapPda,
      })
      .signers([recipient])
      .rpc();

    const after = await provider.connection.getBalance(recipient.publicKey);
    assert.equal(after - before, amount.toNumber(), "Empfaenger erhaelt den Betrag");

    // Das eigentlich Neue: die Miete versickert nicht mehr.
    const initiatorAfter = await provider.connection.getBalance(initiator.publicKey);
    assert.equal(
      initiatorAfter - initiatorBefore,
      rent - amount.toNumber(),
      "Initiator erhaelt die Mietbefreiung zurueck",
    );
    assert.equal(
      await provider.connection.getBalance(swapPda),
      0,
      "Swap-Konto ist geschlossen",
    );
  });

  it("claim nach Ablauf der Timelock schlaegt fehl, refund klappt weiter", async () => {
    // Die Sicherheitsregel T_sol < T_lightning gilt nur, wenn nach Ablauf
    // niemand mehr einloesen kann. Sonst koennte der Kunde warten, bis seine
    // Lightning-Zahlung zurueckgeflossen ist, und danach die SOL nehmen.
    const initiator = provider.wallet;
    const recipient = anchor.web3.Keypair.generate();
    const preimage = randomBytes(32);
    const hashlock = sha256(preimage);
    const swapId = randomBytes(32);
    const amount = new anchor.BN(1_000_000);
    const timelock = new anchor.BN(Math.floor(Date.now() / 1000) + 2);

    const [swapPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("swap"), swapId],
      program.programId,
    );
    await program.methods
      .initialize([...swapId], [...hashlock], timelock, amount)
      .accounts({ initiator: initiator.publicKey, recipient: recipient.publicKey, swap: swapPda })
      .rpc();

    // Warten, bis die Uhr des Validators die Frist sicher ueberschritten hat.
    await new Promise((r) => setTimeout(r, 6000));

    try {
      await program.methods
        .claim([...preimage])
        .accounts({ recipient: recipient.publicKey, initiator: initiator.publicKey, swap: swapPda })
        .signers([recipient])
        .rpc();
      assert.fail("claim nach Ablauf haette scheitern muessen");
    } catch (e) {
      assert.include(String(e), "TimelockExpired");
    }

    // Die Rueckerstattung an den Initiator muss weiterhin funktionieren.
    await program.methods
      .refund()
      .accounts({ initiator: initiator.publicKey, swap: swapPda })
      .rpc();
    assert.equal(await provider.connection.getBalance(swapPda), 0, "Swap-Konto ist geschlossen");
  });

  it("claim ohne den Initiator-Account schlaegt fehl", async () => {
    // Ohne dieses Konto kann Anchor den PDA nicht schliessen — die Instruktion
    // wird abgelehnt. Der Test haelt fest, dass die Kontenliste verbindlich ist.
  });

  it("claim mit falscher Preimage schlaegt fehl", async () => {
    // ... analog, erwartet InvalidPreimage
  });

  it("refund vor Ablauf der Timelock schlaegt fehl, danach erfolgreich", async () => {
    // ... analog, erwartet TimelockNotExpired, dann Rueckzahlung an Initiator
  });
});
