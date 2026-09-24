//! Solana-HTLC-Programm (vollstaendige Referenz).
//!
//! Sperrt native SOL hinter (Hashlock H = SHA-256, Timelock, Empfaenger).
//! - `initialize`: Initiator (LP) sperrt `amount` Lamports im Swap-PDA.
//! - `claim`:      Empfaenger (Nutzer) loest ein, indem er die Preimage R zeigt;
//!                 sha256(R) == H. R wird dadurch on-chain oeffentlich, sodass
//!                 der LP anschliessend die Lightning-Hold-Invoice abrechnen kann.
//! - `refund`:     Nach Ablauf der Timelock zurueck an den Initiator.
//!
//! Die escrowten Lamports liegen im programm-eigenen Swap-PDA; claim/refund
//! verschieben sie per direkter Lamport-Arithmetik (zulaessig, da das Programm
//! den Account besitzt).
//!
//! SPL-Token-Variante: statt nativer Lamports einen Token-Vault (PDA-ATA) nutzen
//! und per CPI `token::transfer` bewegen. Analog, hier zur Klarheit auf SOL.
//!
//! HINWEIS: In diesem Build-Container nicht kompiliert (keine Solana/Anchor-
//! Toolchain). Build/Deploy: siehe contracts/solana-htlc/README.
//! Vor Mainnet: Audits, Testnet, Bug-Bounty. Immutable = unpatchbar.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash; // SHA-256

declare_id!("B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk");

#[program]
pub mod solana_htlc {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        swap_id: [u8; 32],
        hashlock: [u8; 32],
        timelock: i64, // Unix-Sekunden, ab denen Refund moeglich ist
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, HtlcError::ZeroAmount);
        require!(timelock > Clock::get()?.unix_timestamp, HtlcError::TimelockInPast);

        // amount Lamports vom Initiator in den Swap-PDA transferieren.
        let cpi = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.initiator.key(),
            &ctx.accounts.swap.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &cpi,
            &[
                ctx.accounts.initiator.to_account_info(),
                ctx.accounts.swap.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let s = &mut ctx.accounts.swap;
        s.swap_id = swap_id;
        s.initiator = ctx.accounts.initiator.key();
        s.recipient = ctx.accounts.recipient.key();
        s.hashlock = hashlock;
        s.timelock = timelock;
        s.amount = amount;
        s.claimed = false;
        s.refunded = false;
        s.bump = ctx.bumps.swap;
        Ok(())
    }

    /// Loest den Swap ein.
    ///
    /// `preimage` ist ein FESTES [u8; 32] und kein Vec<u8> mehr. Ein
    /// unbegrenzter Vektor liess einen Aufrufer beliebig grosse Daten
    /// schicken — Rechenzeit und Transaktionsgroesse ohne Not, und die
    /// Laengenpruefung musste der Hash uebernehmen.
    ///
    /// ACHTUNG BEIM KODIEREN: Borsh serialisiert [u8; 32] OHNE
    /// Laengenpraefix, Vec<u8> MIT (4 Byte little-endian). Client und
    /// Programm muessen daher zusammen geaendert werden.
    pub fn claim(ctx: Context<Claim>, preimage: [u8; 32]) -> Result<()> {
        let s = &mut ctx.accounts.swap;
        require!(!s.claimed && !s.refunded, HtlcError::AlreadyClosed);
        // Einloesen nur VOR Ablauf. Ohne diese Pruefung waeren nach Ablauf
        // claim und refund beide moeglich, und die Regel T_sol < T_lightning
        // liefe ins Leere: Der Kunde koennte warten, bis seine Lightning-
        // Zahlung zurueckgeflossen ist, und danach trotzdem die SOL nehmen.
        require!(Clock::get()?.unix_timestamp < s.timelock, HtlcError::TimelockExpired);
        require!(hash(&preimage).to_bytes() == s.hashlock, HtlcError::InvalidPreimage);
        require_keys_eq!(ctx.accounts.recipient.key(), s.recipient, HtlcError::WrongRecipient);
        // Die Miete gehoert dem, der sie gezahlt hat. Ohne diese Pruefung
        // koennte ein Aufrufer ein beliebiges Konto als Empfaenger der
        // Rueckerstattung angeben.
        require_keys_eq!(ctx.accounts.initiator.key(), s.initiator, HtlcError::WrongInitiator);

        s.claimed = true;
        let amount = s.amount;
        // Lamports vom programm-eigenen Swap-PDA an den Empfaenger.
        **ctx.accounts.swap.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

        // R wird durch die Instruktionsdaten on-chain oeffentlich.
        emit!(Claimed { swap_id: ctx.accounts.swap.swap_id, preimage });
        // Das Konto wird durch `close = initiator` geschlossen; was nach der
        // Auszahlung uebrig bleibt, ist genau die Mietbefreiung und geht
        // zurueck an den Initiator. Vorher blieb sie dauerhaft gebunden —
        // rund 0,0016 SOL Verlust pro Swap.
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let s = &mut ctx.accounts.swap;
        require!(!s.claimed && !s.refunded, HtlcError::AlreadyClosed);
        require!(Clock::get()?.unix_timestamp >= s.timelock, HtlcError::TimelockNotExpired);
        require_keys_eq!(ctx.accounts.initiator.key(), s.initiator, HtlcError::WrongInitiator);

        s.refunded = true;
        // Kein manueller Transfer noetig: `close = initiator` gibt dem
        // Initiator ohnehin ALLE Lamports des Kontos zurueck — Betrag und
        // Mietbefreiung in einem Schritt.
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(swap_id: [u8; 32])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>,
    /// CHECK: nur die Pubkey wird gespeichert (Empfaenger = Nutzer).
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init,
        payer = initiator,
        space = 8 + Swap::LEN,
        seeds = [b"swap", swap_id.as_ref()],
        bump
    )]
    pub swap: Account<'info, Swap>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,
    /// CHECK: Gegen swap.initiator geprueft; erhaelt nur die Mietbefreiung
    /// zurueck, wenn das Konto geschlossen wird.
    #[account(mut)]
    pub initiator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"swap", swap.swap_id.as_ref()],
        bump = swap.bump,
        close = initiator
    )]
    pub swap: Account<'info, Swap>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"swap", swap.swap_id.as_ref()],
        bump = swap.bump,
        close = initiator
    )]
    pub swap: Account<'info, Swap>,
}

#[account]
pub struct Swap {
    pub swap_id: [u8; 32],
    pub initiator: Pubkey,
    pub recipient: Pubkey,
    pub hashlock: [u8; 32],
    pub timelock: i64,
    pub amount: u64,
    pub claimed: bool,
    pub refunded: bool,
    pub bump: u8,
}

impl Swap {
    // 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1
    pub const LEN: usize = 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1;
}

#[event]
pub struct Claimed {
    pub swap_id: [u8; 32],
    pub preimage: [u8; 32],
}

#[error_code]
pub enum HtlcError {
    #[msg("Betrag muss > 0 sein")]
    ZeroAmount,
    #[msg("Timelock liegt in der Vergangenheit")]
    TimelockInPast,
    #[msg("Swap bereits eingeloest oder zurueckerstattet")]
    AlreadyClosed,
    #[msg("Preimage passt nicht zum Hashlock")]
    InvalidPreimage,
    #[msg("Falscher Empfaenger")]
    WrongRecipient,
    #[msg("Falscher Initiator")]
    WrongInitiator,
    #[msg("Timelock noch nicht abgelaufen")]
    TimelockNotExpired,
    // Bewusst als letzte Variante: So behalten alle bisherigen Fehler ihre Codes.
    #[msg("Timelock abgelaufen - nur noch Rueckerstattung moeglich")]
    TimelockExpired,
}
