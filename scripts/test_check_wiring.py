#!/usr/bin/env python3
"""
Selbsttest fuer check-wiring.py (Schritt 1.4).

Die Faelle, an denen die erste Fassung vorbeisah: ein Export, der nur als
Eigenschaft oder Schluessel vorkommt (`giftWrap: true`), und einer, der nur von
einer ihrerseits unbenutzten Funktion gerufen wird. Dazu die Ausnahmeliste:
begruendet ausgenommen, veraltet, fehlend.

Aufruf: python3 scripts/test_check_wiring.py
"""
import subprocess, sys, tempfile, unittest
from pathlib import Path

SKRIPT = Path(__file__).with_name("check-wiring.py")

PROTOKOLL = """\
/** Kommentar nennt nurImKommentar() – zaehlt nicht. */
export function direkt(): number { return 1; }
export async function perKette(): Promise<number> { return helfer(); }
function helfer(): number { return tief(); }
export function tief(): number { return 2; }
export function nurTest(): number { return 3; }
export function nurSchluessel(): number { return 4; }
export function nurEigenschaft(): number { return 5; }
export function nurImString(): number { return 6; }
export function totAnfang(): number { return totEnde(); }
export function totEnde(): number { return 7; }
export class Werkzeug { lauf(): number { return 8; } }
export function nachRegex(): number { return 10; }
export const keineFunktion = 9;
"""

APP = """\
import { direkt, perKette, Werkzeug } from "@freedomstack/protocol";
const konfig = { nurSchluessel: true };
const x = konfig.nurEigenschaft;
console.log("nurImString", direkt(), await perKette(), new Werkzeug());
// Backticks in einem Regex-Literal sind kein Template-String:
const muster = /`([^`\\n]+)`/g; // wie in renderMarkdown: drei Backticks
nachRegex();
"""

TEST = 'import { nurTest } from "../src/modul.js"; nurTest();\n'


def lauf(wurzel, *args):
    r = subprocess.run([sys.executable, str(SKRIPT), "--wurzel", str(wurzel), *args],
                       capture_output=True, text=True)
    return r.returncode, r.stdout


class Verdrahtung(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        w = self.w = Path(self.tmp.name)
        for d in ("packages/protocol/src", "packages/protocol/test", "packages/app/src", "packages/node/src", "scripts"):
            (w / d).mkdir(parents=True)
        (w / "packages/protocol/src/modul.ts").write_text(PROTOKOLL, encoding="utf-8")
        (w / "packages/protocol/test/modul.test.ts").write_text(TEST, encoding="utf-8")
        (w / "packages/app/src/app.ts").write_text(APP, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def offen(self):
        _, aus = lauf(self.w)
        zeile = next((z for z in aus.splitlines() if z.strip().startswith("modul.ts:")), "")
        return set(x.strip() for x in zeile.split(":", 1)[1].split(",")) if zeile else set()

    def test_verdrahtet_direkt_und_ueber_kette(self):
        offen = self.offen()
        for name in ("direkt", "perKette", "tief", "Werkzeug", "nachRegex"):
            self.assertNotIn(name, offen)

    def test_nicht_verdrahtet(self):
        # nurTest: nur im Test; nurSchluessel/nurEigenschaft: kein Aufruf;
        # nurImString/Kommentar: Text; totEnde: nur von unbenutztem totAnfang
        self.assertEqual(self.offen(), {"nurTest", "nurSchluessel", "nurEigenschaft",
                                        "nurImString", "totAnfang", "totEnde"})

    def test_streng_scheitert_ohne_ausnahme(self):
        code, _ = lauf(self.w, "--streng")
        self.assertEqual(code, 1)

    def test_ausnahmen_und_veraltete(self):
        liste = self.w / "scripts/wiring-ausnahmen.txt"
        namen = ["nurTest", "nurSchluessel", "nurEigenschaft", "nurImString", "totAnfang", "totEnde"]
        liste.write_text("".join(f"modul.ts|{n}|Grund\n" for n in namen), encoding="utf-8")
        code, _ = lauf(self.w, "--streng")
        self.assertEqual(code, 0)
        # Ausnahme ohne Begruendung zaehlt nicht
        liste.write_text("".join(f"modul.ts|{n}|\n" for n in namen), encoding="utf-8")
        self.assertEqual(lauf(self.w, "--streng")[0], 1)
        # Ausnahme fuer etwas Verdrahtetes ist veraltet
        liste.write_text("".join(f"modul.ts|{n}|Grund\n" for n in namen + ["direkt"]), encoding="utf-8")
        code, aus = lauf(self.w, "--streng")
        self.assertEqual(code, 1)
        self.assertIn("veraltete Ausnahme (verdrahtet oder entfernt): modul.ts|direkt", aus)

    def test_zahlwege_nur_ueber_die_schienen(self):
        # Schritt 4.1: ein Wallet-Zugriff ausserhalb der Schienen laesst --streng scheitern
        liste = self.w / "scripts/wiring-ausnahmen.txt"
        namen = ["nurTest", "nurSchluessel", "nurEigenschaft", "nurImString", "totAnfang", "totEnde"]
        liste.write_text("".join(f"modul.ts|{n}|Grund\n" for n in namen), encoding="utf-8")
        (self.w / "packages/app/src/rails.ts").write_text("await nwc.payInvoice(x);\n", encoding="utf-8")
        self.assertEqual(lauf(self.w, "--streng")[0], 0, "in rails.ts erlaubt")
        (self.w / "packages/app/src/zap.ts").write_text("// kommentar: w.sendPayment(x) zaehlt nicht\n", encoding="utf-8")
        self.assertEqual(lauf(self.w, "--streng")[0], 0, "Kommentar zaehlt nicht")
        (self.w / "packages/app/src/zap.ts").write_text("const r = await w.sendPayment(rechnung);\n", encoding="utf-8")
        code, aus = lauf(self.w, "--streng")
        self.assertEqual(code, 1)
        self.assertIn("Wallet-Zugriff ausserhalb der Zahlschienen: zap.ts", aus)


if __name__ == "__main__":
    unittest.main(verbosity=2)
