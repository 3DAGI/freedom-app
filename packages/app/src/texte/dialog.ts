/** Texte der Dialoge (Schritt C.2b1, `shell/dialog.ts`). */
import type { Texte } from "../i18n.js";

export const dialog: Texte = {
  "dlg.ok": { de: "OK", en: "OK" },
  "dlg.abbrechen": { de: "Abbrechen", en: "Cancel" },
  "dlg.schliessen": { de: "Schließen", en: "Close" },
  "dlg.kopieren": { de: "Kopieren", en: "Copy" },
  "dlg.kopiert": { de: "Kopiert", en: "Copied" },
  "dlg.pflicht": { de: "Bitte ausfüllen", en: "Please fill in" },
  // QR-Codes (11.1b, `shell/qr-ui.ts`)
  "qr.zeigen": { de: "QR-Code zeigen", en: "Show QR code" },
  "qr.verbergen": { de: "QR-Code verbergen", en: "Hide QR code" },
  "qr.geheimWarnung": { de: "Nur dem eigenen neuen Gerät zeigen: Wer diesen Code sieht oder fotografiert, kann als dieses Gerät in deinem Namen schreiben.", en: "Show it only to your own new device: whoever sees or photographs this code can write in your name as this device." },
  "qr.verschwindet": { de: "Verschwindet nach {s} Sekunden – niemanden mitfotografieren lassen.", en: "Disappears after {s} seconds – don't let anyone else photograph it." },
  "qr.scannen": { de: "Mit der Kamera scannen", en: "Scan with the camera" },
  "qr.scanStopp": { de: "Kamera aus", en: "Camera off" },
  "qr.halteHin": { de: "Halte den QR-Code vor die Kamera – das Bild bleibt auf diesem Gerät.", en: "Hold the QR code in front of the camera – the image stays on this device." },
  "qr.gelesen": { de: "Code gelesen – prüfen und bestätigen.", en: "Code read – check and confirm." },
  "qr.keinScan": { de: "Dieser Browser kann QR-Codes nicht mit der Kamera lesen – bitte den Code einfügen.", en: "This browser can't read QR codes with the camera – please paste the code." },
  "qr.keineKamera": { de: "Keine Kamera verfügbar oder nicht erlaubt – bitte den Code einfügen.", en: "No camera available or not allowed – please paste the code." },
};
