#!/usr/bin/env python3
"""
Selbsttest für android-bitchat.py (B-36b1): Rechte, Klasse und Keep-Regel landen im erzeugten Android-Projekt, zweimal
eintragen ändert nichts, und `--pruefen` meldet jede Lücke. Dazu hält er die Kotlin-Klasse bei Dienst und Merkmal von
Bitchat und bei den Methoden, die die Hülle über JNI ruft.

Aufruf: python3 scripts/test_android_bitchat.py
"""
import importlib.util, io, re, shutil, sys, tempfile, unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from xml.dom import minidom

spec = importlib.util.spec_from_file_location("android_bitchat", Path(__file__).with_name("android-bitchat.py"))
ab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ab)

VORLAGE = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="FreedomStack" />
</manifest>
"""


class Projekt(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "src/main").mkdir(parents=True)
        (self.tmp / "src/main/AndroidManifest.xml").write_text(VORLAGE, encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp)

    def lauf(self, *args: str) -> int:
        sys.argv = ["android-bitchat.py", str(self.tmp), *args]
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return ab.main()

    def test_eintragen_einmal_und_pruefen(self) -> None:
        self.assertEqual(self.lauf("--pruefen"), 1, "leeres Projekt fällt durch")
        self.assertEqual(self.lauf(), 0)
        manifest = (self.tmp / "src/main/AndroidManifest.xml").read_text(encoding="utf-8")
        self.assertEqual(self.lauf(), 0)
        self.assertEqual((self.tmp / "src/main/AndroidManifest.xml").read_text(encoding="utf-8"), manifest, "zweimal = einmal")
        minidom.parseString(manifest)
        self.assertIn('BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation"', manifest)
        self.assertIn('ACCESS_FINE_LOCATION" android:maxSdkVersion="30"', manifest)
        self.assertIn('bluetooth_le" android:required="false"', manifest)
        self.assertEqual(self.lauf("--pruefen"), 0)

    def test_jede_luecke_faellt_auf(self) -> None:
        self.lauf()
        m = self.tmp / "src/main/AndroidManifest.xml"
        voll = m.read_text(encoding="utf-8")
        m.write_text(re.sub(r'\s*<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />', "", voll), encoding="utf-8")
        self.assertEqual(self.lauf("--pruefen"), 1, "Recht fehlt")
        m.write_text(voll, encoding="utf-8")
        (self.tmp / ab.ZIEL).write_text("// alt\n", encoding="utf-8")
        self.assertEqual(self.lauf("--pruefen"), 1, "Klasse veraltet")
        self.lauf()
        (self.tmp / "freedom-bitchat.pro").unlink()
        self.assertEqual(self.lauf("--pruefen"), 1, "Keep-Regel fehlt")


class Klasse(unittest.TestCase):
    def test_dienst_merkmal_und_jni(self) -> None:
        kt = ab.QUELLE.read_text(encoding="utf-8")
        # Werte aus BLEService.swift (Mainnet) – nicht die Testfassung …4b5a
        self.assertIn('"f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c"', kt)
        self.assertIn('"a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d"', kt)
        self.assertIn("package io.github.threedagi.freedom", kt)
        for sig in ["fun stand(k: Context): String", "fun starte(activity: Activity): String", "fun stoppe()",
                    "fun sende(id: String, wert: ByteArray): Boolean", "fun hole(): ByteArray"]:
            self.assertRegex(kt, r"@JvmStatic\s+" + re.escape(sig), sig)
        self.assertIn(".setIncludeDeviceName(false)", kt, "kein Gerätename in der Werbung")
        # B-36b2: gesucht wird nur nach dem Dienst von Bitchat, höchstens 6 Verbindungen als Central
        self.assertIn("ScanFilter.Builder().setServiceUuid(ParcelUuid(DIENST))", kt)
        self.assertIn("private const val ZENTRAL_MAX = 6", kt)


if __name__ == "__main__":
    unittest.main()
