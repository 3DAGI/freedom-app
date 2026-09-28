/** Fehlermeldungen des Protokolls (8.16i, `ProtokollFehler`) – Deutsch wortgleich mit dem Protokoll (`fehlerText()`, Test). */
import type { Texte } from "../i18n.js";

export const fehler: Texte = {
  // Solana-RPC (RpcPool)
  "pf.rpcUnerreichbar": { de: "Kein Solana-Endpunkt erreichbar ({n} versucht). {details}", en: "No Solana endpoint reachable ({n} tried). {details}" },
  // Lightning-Rechnung (leseBolt11)
  "pf.bolt11Praefix": { de: "kein bolt11-Präfix", en: "not a bolt11 prefix" },
  "pf.bolt11Betrag": { de: "ungültiger Betrag in der Rechnung", en: "invalid amount in the invoice" },
  "pf.bolt11Kurz": { de: "Rechnung zu kurz", en: "invoice too short" },
  "pf.bolt11Feld": { de: "abgeschnittenes Feld", en: "truncated field" },
  "pf.bolt11Hash": { de: "Rechnung ohne Payment-Hash", en: "invoice without a payment hash" },
  "pf.bolt11Recovery": { de: "ungültige Recovery-ID", en: "invalid recovery ID" },
  "pf.bolt11Signatur": { de: "Signatur der Rechnung ungültig", en: "invoice signature invalid" },
  "pf.bolt11Knoten": { de: "Signatur passt nicht zum genannten Knoten", en: "signature does not match the named node" },
  // Wallet über NWC (parseNwcUri, NwcClient)
  "pf.nwcPraefix": { de: "Keine NWC-Verbindung: erwartet wird nostr+walletconnect://…", en: "Not an NWC connection: expected nostr+walletconnect://…" },
  "pf.nwcPubkey": { de: "NWC-URI: Wallet-Pubkey ist kein gültiger 64-stelliger Hex-Wert.", en: "NWC URI: the wallet pubkey is not a valid 64-character hex value." },
  "pf.nwcRelay": { de: "NWC-URI: kein relay angegeben.", en: "NWC URI: no relay given." },
  "pf.nwcSecret": { de: "NWC-URI: secret fehlt oder ist kein 64-stelliger Hex-Wert.", en: "NWC URI: the secret is missing or not a 64-character hex value." },
  "pf.nwcMethode": { de: "Dieses Wallet unterstützt \"{methode}\" nicht.", en: "This wallet does not support \"{methode}\"." },
  "pf.nwcKeinRelay": { de: "Kein Relay hat das Wallet-Kommando angenommen — Netzwerkproblem.", en: "No relay accepted the wallet command — network problem." },
  "pf.nwcGuthaben": { de: "Das Wallet hat nicht genug Guthaben für diese Zahlung.", en: "The wallet does not have enough balance for this payment." },
  "pf.nwcBudget": { de: "Das für diese Verbindung gesetzte Budget ist aufgebraucht. Im Wallet erhöhen.", en: "The budget set for this connection is used up. Raise it in the wallet." },
  "pf.nwcVerboten": { de: "Diese Verbindung darf die angeforderte Aktion nicht ausführen.", en: "This connection may not perform the requested action." },
  "pf.nwcWiderrufen": { de: "Die Verbindung wurde im Wallet widerrufen. Bitte neu verbinden.", en: "The connection was revoked in the wallet. Please reconnect." },
  "pf.nwcNichtUnterstuetzt": { de: "Dieses Wallet unterstützt die angeforderte Funktion nicht.", en: "This wallet does not support the requested function." },
  "pf.nwcZahlung": { de: "Die Zahlung ist fehlgeschlagen — meist fehlt eine Route zum Empfänger.", en: "The payment failed — usually there is no route to the recipient." },
  "pf.nwcZuViele": { de: "Zu viele Anfragen an das Wallet. Kurz warten.", en: "Too many requests to the wallet. Wait a moment." },
  "pf.nwcFehler": { de: "Wallet-Fehler: {code}", en: "Wallet error: {code}" },
  "pf.nwcZeit": { de: "Das Wallet hat in {sekunden}s nicht geantwortet. Ist es online und mit denselben Relays verbunden?", en: "The wallet did not answer within {sekunden}s. Is it online and connected to the same relays?" },
  // Zahlschienen (pruefeAnfrage, waehleRail) und Beträge
  "pf.schieneZiel": { de: "Ziel passt nicht zur Schiene {schiene}", en: "Destination does not match the {schiene} rail" },
  "pf.schieneEinheit": { de: "Betrag in {einheit}, {schiene} rechnet in {rechnet}", en: "Amount in {einheit}, {schiene} works in {rechnet}" },
  "pf.schieneReferenz": { de: "Referenz nur als Solana-Adresse", en: "Reference only as a Solana address" },
  "pf.schieneUnbekannt": { de: "Unbekanntes Zahlungsziel", en: "Unknown payment destination" },
  "pf.schieneFehlt": { de: "Keine Schiene für {schiene}", en: "No rail for {schiene}" },
  "pf.offlineSats": { de: "Offline: Sats gehen erst wieder, wenn Netz da ist – Lightning braucht mehrere Runden Austausch. Nachrichten gehen über Funk oder per Datei.", en: "Offline: sats only work again once the network is back – Lightning needs several rounds of exchange. Messages go over radio or by file." },
  "pf.offlineSol": { de: "Offline: Diese SOL-Zahlung braucht Netz. Ohne Netz zahlst du mit dem Nonce-Konto (Wallet-Tab → Ohne Internet zahlen) – ein Gerät mit Netz reicht ein.", en: "Offline: this SOL payment needs the network. Without network you pay with the nonce account (Wallet tab → Pay without internet) – a device with network submits it." },
  "pf.walletFehltSats": { de: "Keine Lightning-Wallet verbunden – im Wallet-Tab per NWC verbinden.", en: "No Lightning wallet connected – connect one via NWC in the Wallet tab." },
  "pf.walletFehltSol": { de: "Keine Solana-Wallet verbunden – im Wallet-Tab verbinden.", en: "No Solana wallet connected – connect one in the Wallet tab." },
  "pf.betragPositiv": { de: "Betrag muss eine positive ganze Zahl sein", en: "The amount must be a positive whole number" },
  "pf.limitUngueltig": { de: "Limit muss eine nicht negative ganze Zahl sein", en: "The limit must be a non-negative whole number" },
  "pf.kanalBetrag": { de: "Betrag muss größer als 0 sein", en: "The amount must be greater than 0" },
  // SOL ohne Internet (sol-offline)
  "pf.nonceNichtEingerichtet": { de: "Nonce-Konto ist nicht eingerichtet", en: "The nonce account is not set up" },
  "pf.anSichSelbst": { de: "Überweisung an sich selbst", en: "Transfer to yourself" },
  "pf.nonceAndereAdresse": { de: "Das Nonce-Konto gehört einer anderen Adresse", en: "The nonce account belongs to a different address" },
  // Rück-Swap (rueckSwapLamports)
  "pf.rueckBetrag": { de: "Betrag in sats ungültig", en: "Amount in sats invalid" },
  "pf.rueckKurs": { de: "Kurs ungültig", en: "Rate invalid" },
  "pf.rueckGebuehr": { de: "Gebühr ungültig", en: "Fee invalid" },
  // SOL-Trinkgeld (buildSolTrinkgeld)
  "pf.trinkgeldBetrag": { de: "Betrag muss eine positive ganze Zahl (Lamports) sein", en: "The amount must be a positive whole number (lamports)" },
  "pf.solAdresse": { de: "keine gültige SOL-Adresse", en: "not a valid SOL address" },
  "pf.trinkgeldNotiz": { de: "Notiz höchstens {max} Zeichen", en: "Note at most {max} characters" },
  // Zustandssicherung (buildStateBackup)
  "pf.sicherungGross": { de: "Sicherung zu groß ({kb} KB, höchstens {max} KB) – nichts gesendet.", en: "Backup too large ({kb} KB, at most {max} KB) – nothing sent." },
};
