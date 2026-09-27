//! Solana-Zahlkanal (Schritt 4.3). Format: `docs/ZAHLKANAL.md`.
//!
//! Der Kunde zahlt einmal in einen Kanal ein (`open`) und bezahlt danach jede
//! Antwort mit einer Gutschrift: einer Ed25519-Signatur seines
//! Sitzungsschluessels ueber den bisher geschuldeten Gesamtbetrag. Der Provider
//! loest die hoechste Gutschrift ein (`settle`); das Programm teilt die Zahlung
//! fest auf die Empfaenger des Gebuehrenmodells A+ auf. Nach Ablauf holt der
//! Kunde den Rest zurueck (`refund`).
//!
//! Die Gutschrift prueft das Ed25519-Programm der Laufzeit: Die Anweisung
//! direkt vor `settle` muss genau diese Signatur tragen. Hier wird nur
//! geprueft, dass sie da ist, auf sich selbst zeigt und Schluessel und
//! Nachricht stimmen – die Signatur selbst verwirft die Laufzeit vorher.
//!
//! Die Lamports liegen im programm-eigenen Kanal-PDA; `settle` verschiebt sie
//! per direkter Lamport-Arithmetik (zulaessig, das Programm besitzt das Konto).
//!
//! Programm-ID: Platzhalter ohne Schluessel bis zum Deploy (MENSCH), siehe
//! `docs/ZAHLKANAL.md`. Nie `--final` durch den Agenten.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions as anweisungen;
use anchor_lang::system_program;

declare_id!("7tukwiJ8cKiWPmkhH2seJycWebHuZy1XLXEZYAMLB5Dj");

/// Hoechstens so viele Empfaenger je Kanal (Platz im Konto ist fest).
pub const MAX_EMPFAENGER: usize = 8;
/// Obergrenze aller Anteile ausser dem Provider: 10 % (Entscheidung 4.0).
pub const MAX_ANTEILE_PPM: u64 = 100_000;
/// Domain-Praefix der Gutschrift; ein anderes Format heisst neues Programm.
pub const PRAEFIX: &[u8] = b"freedomstack-channel-v1";

#[program]
pub mod solana_channel {
    use super::*;

    pub fn open(
        ctx: Context<Open>,
        nonce: u64,
        amount: u64,
        expiry: i64,
        session_key: Pubkey,
        fee_recipients: Vec<FeeRecipient>,
    ) -> Result<()> {
        require!(amount > 0, KanalFehler::NullBetrag);
        require!(expiry > Clock::get()?.unix_timestamp, KanalFehler::Abgelaufen);
        require!(fee_recipients.len() <= MAX_EMPFAENGER, KanalFehler::ZuVieleEmpfaenger);
        let kanal = ctx.accounts.channel.key();
        let mut summe: u64 = 0;
        for r in fee_recipients.iter() {
            require!(r.ppm >= 1, KanalFehler::AnteilUngueltig);
            require_keys_neq!(r.address, kanal, KanalFehler::KanalAlsEmpfaenger);
            summe += r.ppm as u64;
        }
        require!(summe <= MAX_ANTEILE_PPM, KanalFehler::AnteileZuHoch);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.customer.to_account_info(),
                    to: ctx.accounts.channel.to_account_info(),
                },
            ),
            amount,
        )?;

        let c = &mut ctx.accounts.channel;
        c.customer = ctx.accounts.customer.key();
        c.provider = ctx.accounts.provider.key();
        c.session_key = session_key;
        c.nonce = nonce;
        c.deposited = amount;
        c.settled = 0;
        c.expiry = expiry;
        c.fee_recipients = fee_recipients;
        c.bump = ctx.bumps.channel;
        Ok(())
    }

    /// Loest die Gutschrift ueber `cumulative_amount` ein. Auszahlbar ist
    /// `min(cumulative_amount, deposited) − settled`; eine aeltere oder gleiche
    /// Gutschrift zahlt nichts und scheitert.
    pub fn settle(ctx: Context<Settle>, cumulative_amount: u64) -> Result<()> {
        let kanal = ctx.accounts.channel.key();
        let (session_key, expiry, deposited, settled, empfaenger) = {
            let c = &ctx.accounts.channel;
            (c.session_key, c.expiry, c.deposited, c.settled, c.fee_recipients.clone())
        };
        // Nur vor Ablauf: danach gehoert der Rest dem Kunden (refund).
        require!(Clock::get()?.unix_timestamp < expiry, KanalFehler::Abgelaufen);
        pruefe_gutschrift(&ctx.accounts.instructions, &session_key, &kanal, cumulative_amount, expiry)?;

        let ziel = cumulative_amount.min(deposited);
        require!(ziel > settled, KanalFehler::NichtsAuszuzahlen);
        let auszahlbar = ziel - settled;

        require!(ctx.remaining_accounts.len() == empfaenger.len(), KanalFehler::EmpfaengerFalsch);
        let miete = Rent::get()?;
        let kanal_info = ctx.accounts.channel.to_account_info();
        let mut an_empfaenger: u64 = 0;
        for (konto, r) in ctx.remaining_accounts.iter().zip(empfaenger.iter()) {
            require_keys_eq!(konto.key(), r.address, KanalFehler::EmpfaengerFalsch);
            // Schreibbar verlangt: Sonst koennte der Provider einen Empfaenger
            // unbeschreibbar uebergeben und dessen Anteil selbst behalten.
            require!(konto.is_writable, KanalFehler::EmpfaengerFalsch);
            let anteil = ((auszahlbar as u128) * (r.ppm as u128) / 1_000_000u128) as u64;
            if anteil == 0 || konto.executable {
                continue;
            }
            // Bliebe das Konto unter der Mietbefreiung, lehnte die Laufzeit
            // die ganze Transaktion ab – ein leeres Empfaengerkonto blockierte
            // jede Abrechnung. Nicht zuordenbar heisst: an den Provider (A+).
            let danach = konto.lamports().checked_add(anteil).ok_or(KanalFehler::Ueberlauf)?;
            if danach < miete.minimum_balance(konto.data_len()) {
                continue;
            }
            **kanal_info.try_borrow_mut_lamports()? -= anteil;
            **konto.try_borrow_mut_lamports()? += anteil;
            an_empfaenger += anteil;
        }
        let provider_anteil = auszahlbar - an_empfaenger;
        **kanal_info.try_borrow_mut_lamports()? -= provider_anteil;
        **ctx.accounts.provider.to_account_info().try_borrow_mut_lamports()? += provider_anteil;

        ctx.accounts.channel.settled = ziel;
        Ok(())
    }

    /// Nach Ablauf: Rest und Miete an den Kunden, das Konto wird geschlossen.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.channel.expiry,
            KanalFehler::NochNichtAbgelaufen
        );
        Ok(())
    }

    pub fn top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
        require!(amount > 0, KanalFehler::NullBetrag);
        require!(Clock::get()?.unix_timestamp < ctx.accounts.channel.expiry, KanalFehler::Abgelaufen);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.customer.to_account_info(),
                    to: ctx.accounts.channel.to_account_info(),
                },
            ),
            amount,
        )?;
        let c = &mut ctx.accounts.channel;
        c.deposited = c.deposited.checked_add(amount).ok_or(KanalFehler::Ueberlauf)?;
        Ok(())
    }
}

/// Die signierte Bytefolge: Praefix ‖ Kanal ‖ Betrag (u64 LE) ‖ Ablauf (i64 LE).
pub fn gutschrift(kanal: &Pubkey, betrag: u64, ablauf: i64) -> Vec<u8> {
    let mut n = Vec::with_capacity(PRAEFIX.len() + 48);
    n.extend_from_slice(PRAEFIX);
    n.extend_from_slice(kanal.as_ref());
    n.extend_from_slice(&betrag.to_le_bytes());
    n.extend_from_slice(&ablauf.to_le_bytes());
    n
}

/// Die Anweisung direkt davor: Ed25519-Programm, genau eine Signatur, alle
/// Offsets auf sich selbst (0xFFFF), Schluessel = session_key, Nachricht =
/// Gutschrift. Zeigte ein Offset auf eine andere Anweisung, koennte dort eine
/// fremde Nachricht stehen.
fn pruefe_gutschrift(
    sysvar: &AccountInfo,
    session_key: &Pubkey,
    kanal: &Pubkey,
    betrag: u64,
    ablauf: i64,
) -> Result<()> {
    let aktuell = anweisungen::load_current_index_checked(sysvar)? as usize;
    require!(aktuell > 0, KanalFehler::GutschriftFehlt);
    let ix = anweisungen::load_instruction_at_checked(aktuell - 1, sysvar)?;
    require_keys_eq!(ix.program_id, ed25519_program::ID, KanalFehler::GutschriftFehlt);
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, KanalFehler::GutschriftUngueltig);
    let feld = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]);
    let (sig_ix, pk_off, pk_ix, msg_off, msg_len, msg_ix) =
        (feld(4), feld(6) as usize, feld(8), feld(10) as usize, feld(12) as usize, feld(14));
    require!(
        sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX,
        KanalFehler::GutschriftUngueltig
    );
    require!(d.len() >= pk_off + 32 && d.len() >= msg_off + msg_len, KanalFehler::GutschriftUngueltig);
    require!(&d[pk_off..pk_off + 32] == session_key.as_ref(), KanalFehler::FalscherSchluessel);
    let erwartet = gutschrift(kanal, betrag, ablauf);
    require!(&d[msg_off..msg_off + msg_len] == erwartet.as_slice(), KanalFehler::GutschriftUngueltig);
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Open<'info> {
    #[account(mut)]
    pub customer: Signer<'info>,
    /// CHECK: nur der Schluessel wird gespeichert.
    pub provider: UncheckedAccount<'info>,
    #[account(
        init,
        payer = customer,
        space = 8 + Channel::LEN,
        seeds = [b"channel", customer.key().as_ref(), provider.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub channel: Account<'info, Channel>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(
        mut,
        has_one = provider @ KanalFehler::FalscherProvider,
        seeds = [b"channel", channel.customer.as_ref(), channel.provider.as_ref(), &channel.nonce.to_le_bytes()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    /// CHECK: das Instruktions-Sysvar, per Adresse geprueft.
    #[account(address = anweisungen::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub customer: Signer<'info>,
    #[account(
        mut,
        has_one = customer @ KanalFehler::FalscherKunde,
        close = customer,
        seeds = [b"channel", channel.customer.as_ref(), channel.provider.as_ref(), &channel.nonce.to_le_bytes()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
}

#[derive(Accounts)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub customer: Signer<'info>,
    #[account(
        mut,
        has_one = customer @ KanalFehler::FalscherKunde,
        seeds = [b"channel", channel.customer.as_ref(), channel.provider.as_ref(), &channel.nonce.to_le_bytes()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct FeeRecipient {
    pub address: Pubkey,
    pub ppm: u32,
}

#[account]
pub struct Channel {
    pub customer: Pubkey,
    pub provider: Pubkey,
    pub session_key: Pubkey,
    pub nonce: u64,
    pub deposited: u64,
    pub settled: u64,
    pub expiry: i64,
    pub fee_recipients: Vec<FeeRecipient>,
    pub bump: u8,
}

impl Channel {
    // 3 Schluessel + 4 Zahlen + Vec-Laenge + 8 Empfaenger (32 + 4) + bump = 421
    pub const LEN: usize = 3 * 32 + 4 * 8 + 4 + MAX_EMPFAENGER * 36 + 1;
}

// Neue Varianten nur ANS ENDE – Fehlercodes duerfen sich nicht verschieben.
#[error_code]
pub enum KanalFehler {
    #[msg("Betrag muss > 0 sein")]
    NullBetrag,
    #[msg("Kanal abgelaufen")]
    Abgelaufen,
    #[msg("Kanal noch nicht abgelaufen")]
    NochNichtAbgelaufen,
    #[msg("Hoechstens 8 Empfaenger")]
    ZuVieleEmpfaenger,
    #[msg("Anteil muss mindestens 1 ppm sein")]
    AnteilUngueltig,
    #[msg("Anteile zusammen ueber 10 %")]
    AnteileZuHoch,
    #[msg("Der Kanal kann nicht Empfaenger sein")]
    KanalAlsEmpfaenger,
    #[msg("Falscher Provider")]
    FalscherProvider,
    #[msg("Falscher Kunde")]
    FalscherKunde,
    #[msg("Keine Ed25519-Anweisung direkt davor")]
    GutschriftFehlt,
    #[msg("Gutschrift passt nicht zu diesem Kanal")]
    GutschriftUngueltig,
    #[msg("Gutschrift nicht vom Sitzungsschluessel")]
    FalscherSchluessel,
    #[msg("Nichts auszuzahlen – Gutschrift nicht hoeher als die letzte")]
    NichtsAuszuzahlen,
    #[msg("Empfaenger passen nicht zum Kanal")]
    EmpfaengerFalsch,
    #[msg("Ueberlauf")]
    Ueberlauf,
}
