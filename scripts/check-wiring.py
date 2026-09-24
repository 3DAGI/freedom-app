#!/usr/bin/env python3
"""
Prueft, ob jeder Protokoll-Baustein tatsaechlich aufgerufen wird.

DER FEHLER, DEN DAS VERHINDERT
Dreimal im Projekt dasselbe Muster: Protokollschicht bauen, sauber testen,
Verdrahtung vergessen. Beim letzten Mal waren neun Mechanismen vollstaendig
untaetig — die Zeitstempel-Absicherung lief ins Leere, der Vertrauensgraph
hatte keine Kante, kein Relay konnte Geld bekommen.

Protokollcode laesst sich testen, Verdrahtung nicht. Deshalb diese Pruefung:
Jeder `build*`-Export muss irgendwo ausserhalb seines eigenen Moduls und
ausserhalb der Tests aufgerufen werden.
"""
import os
import re
import subprocess
import sys

PROTOCOL = os.path.join("packages", "protocol", "src")
CONSUMERS = [
    os.path.join("packages", "app", "src"),
    os.path.join("packages", "node", "src"),
    os.path.join("packages", "protocol", "src"),
    "scripts",
]

# Bausteine, die absichtlich nur vom Protokoll selbst benutzt werden oder
# fuer eine spaetere Phase gebaut sind. Jede Ausnahme braucht eine Begruendung.
ERLAUBT = {
    "buildEvent": "Grundbaustein, ueberall benutzt",
    "buildDM": "intern von dm.ts",
    "buildPairedEvent": "intern von cluster.ts",
    "buildMeshPacket": "intern von mesh-transport.ts",
    "buildNwcRequest": "intern von nwc.ts",
    "buildHttpAuth": "Client-Seite, vom Knoten nur geprueft",
    "buildKeyring": "kein Ereignis-Builder",
    "buildBounty": "Phase 6 — Mitentwickler",
    "buildContribution": "Phase 6 — Mitentwickler",
    "buildFundingRound": "Phase 6 — Mitentwickler",
    "buildAllocation": "Phase 6 — Mitentwickler",
    "buildEpochKeyGrant": "verschluesselte Kanaele ohne Oberflaeche (bewusst)",
    "buildEncryptedMessage": "verschluesselte Kanaele ohne Oberflaeche (bewusst)",
    "buildResolution": "Pruefer-Seite, noch ohne Oberflaeche",
    "buildClusterOffer": "Cluster-Pairing, ohne Oberflaeche",
    "buildDeliveryReceipt": "intern",
    "buildJobFeedback": "intern vom DVM-Client",
    "buildLeaderboard": "Dashboard-Seite",
    "buildSeasonDef": "Saison-Verwaltung von Hand",
    "buildRewardPayout": "vom Pool-Verteiler",
    "buildSolDepositSettle": "Escrow-Pfad",
    "buildReleaseManifest": "scripts/publish-release.mjs",
    "buildRecoveryClaim": "in der App als meldeFuerAnderen",
}


def exports() -> list[str]:
    out: list[str] = []
    for datei in sorted(os.listdir(PROTOCOL)):
        if not datei.endswith(".ts"):
            continue
        inhalt = open(os.path.join(PROTOCOL, datei), encoding="utf-8").read()
        for m in re.finditer(r"^export (?:async )?function (build[A-Z]\w+)", inhalt, re.M):
            out.append(m.group(1))
    return sorted(set(out))


def wird_benutzt(name: str) -> bool:
    for ordner in CONSUMERS:
        if not os.path.isdir(ordner):
            continue
        r = subprocess.run(
            ["grep", "-rlw", "--include=*.ts", "--include=*.mjs", name, ordner],
            capture_output=True, text=True,
        )
        for treffer in r.stdout.splitlines():
            # Die eigene Definition zaehlt nicht als Benutzung.
            inhalt = open(treffer, encoding="utf-8").read()
            if re.search(rf"^export (?:async )?function {name}\b", inhalt, re.M):
                if len(re.findall(rf"\b{name}\b", inhalt)) <= 1:
                    continue
            return True
    return False


def main() -> int:
    fehlend: list[str] = []
    for name in exports():
        if name in ERLAUBT:
            continue
        if not wird_benutzt(name):
            fehlend.append(name)

    if fehlend:
        print("FEHLER: Diese Bausteine werden nirgends aufgerufen —")
        print("sie existieren nur in ihren eigenen Tests:\n")
        for n in fehlend:
            print(f"  · {n}")
        print("\nEntweder verdrahten oder mit Begruendung in ERLAUBT eintragen.")
        return 1

    print(f"Verdrahtung ok — {len(exports())} Bausteine, {len(ERLAUBT)} begruendete Ausnahmen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
