#!/usr/bin/env python3
"""
Selbsttest fuer check_innerhtml.py (Schritt 0.B).

Eine Pruefung, die still etwas uebersieht, ist schlimmer als keine: Sie
meldet "0 Fundstellen" und alle glauben es. Deshalb hier die Faelle, die die
erste Fassung uebersah (verkettete Templates, beide Zweige einer Bedingung,
Templates in .map()), und die, die nie gemeldet werden duerfen.

Aufruf: python3 scripts/test_check_innerhtml.py
"""
import subprocess, sys, tempfile, unittest
from pathlib import Path

SKRIPT = Path(__file__).with_name("check_innerhtml.py")

PROBE = """\
el.innerHTML = `<b>${escapeHtml(a)}</b>` + `<i>${VERKETTET}</i>`;
el.innerHTML = cond ? `<b>${ZWEIG_A}</b>` : ZWEIG_B;
el.innerHTML = liste.map((x) => `<li>${IM_MAP}</li>`).join("");
el.innerHTML = `${x === y}` + `${!z}` + `${n ?? VORGABE}`;
el.innerHTML = "<b>" + ROH + "</b>";
el.innerHTML = `<span>${a ? `<i>${VERSCHACHTELT}</i>` : ANDERER}</span>`;
el.innerHTML = `
  <p>${t("key")} ${icon("x", 12)} ${ganzeZahl(n)} ${42} ${escapeHtml(s)}</p>` +
  // Kommentar mit Apostroph: gibt's
  `<p>${NACH_KOMMENTAR}</p>`;
el.innerHTML = a?.b ? `<i>${OPTIONAL}</i>` : "";
el.insertAdjacentHTML("beforeend", `<p>${ADJACENT}</p>`);
el.innerHTML = `<p>${pkShort(pk)}</p>`;
el.innerHTML = "";
"""

GEMELDET = {"VERKETTET", "ZWEIG_A", "ZWEIG_B", "IM_MAP", "n", "VORGABE", "ROH",
            "VERSCHACHTELT", "ANDERER", "NACH_KOMMENTAR", "OPTIONAL", "ADJACENT",
            "pkShort(pk)"}
NIE_GEMELDET = {"escapeHtml(a)", "x === y", "!z", 't("key")', 'icon("x", 12)',
                "ganzeZahl(n)", "42", "escapeHtml(s)", "cond", "a?.b", "a", '""'}


def lauf(ordner, *args):
    r = subprocess.run([sys.executable, str(SKRIPT), str(ordner), *args],
                       capture_output=True, text=True)
    return r.returncode, r.stdout


def ausdruecke(ausgabe):
    out = set()
    for zeile in ausgabe.splitlines():
        if "  ${" in zeile:
            a = zeile.split("  ${", 1)[1][:-1]
            out.add(a.removeprefix("(Zuweisung) "))
    return out


class Pruefung(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ordner = Path(self.tmp.name)
        (self.ordner / "probe.ts").write_text(PROBE, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_meldet_alle_ungeschuetzten_teile(self):
        _, aus = lauf(self.ordner)
        gefunden = ausdruecke(aus)
        for a in GEMELDET:
            self.assertTrue(any(g == a or g.startswith(a) for g in gefunden), f"nicht gemeldet: {a}")

    def test_meldet_nie_sichere_teile(self):
        _, aus = lauf(self.ordner)
        gefunden = ausdruecke(aus)
        for a in NIE_GEMELDET:
            self.assertNotIn(a, gefunden, f"faelschlich gemeldet: {a}")

    def test_streng_scheitert_ohne_bewertung(self):
        code, _ = lauf(self.ordner, "--streng")
        self.assertEqual(code, 1)

    def test_eine_ausnahme_deckt_genau_eine_stelle(self):
        (self.ordner / "probe.ts").write_text(
            "el.innerHTML = `${cls}`;\nel.innerHTML = `${cls}`;\n", encoding="utf-8")
        liste = self.ordner / "ausnahmen.txt"
        liste.write_text("probe.ts|cls|feste Klasse\n", encoding="utf-8")
        code, aus = lauf(self.ordner, "--ausnahmen", str(liste), "--streng")
        self.assertEqual(code, 1, "zweites ${cls} muss gemeldet werden")
        self.assertIn("1 unbewertete Fundstellen (1 in der Ausnahmeliste)", aus)
        liste.write_text("probe.ts|cls|feste Klasse\nprobe.ts|cls|feste Klasse\n", encoding="utf-8")
        code, _ = lauf(self.ordner, "--ausnahmen", str(liste), "--streng")
        self.assertEqual(code, 0)

    def test_veraltete_ausnahme_faellt_auf(self):
        (self.ordner / "probe.ts").write_text("el.innerHTML = `${escapeHtml(x)}`;\n", encoding="utf-8")
        liste = self.ordner / "ausnahmen.txt"
        liste.write_text("probe.ts|gibtsnicht|alt\n", encoding="utf-8")
        code, aus = lauf(self.ordner, "--ausnahmen", str(liste), "--streng")
        self.assertEqual(code, 1)
        self.assertIn("veraltete Ausnahme", aus)

    def test_senkrechter_strich_im_ausdruck(self):
        (self.ordner / "probe.ts").write_text("el.innerHTML = `${a.b || c.d}`;\n", encoding="utf-8")
        liste = self.ordner / "ausnahmen.txt"
        liste.write_text("probe.ts|a.b|lokal\nprobe.ts|c.d|lokal\n", encoding="utf-8")
        code, _ = lauf(self.ordner, "--ausnahmen", str(liste), "--streng")
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
