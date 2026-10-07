// Die Oberfläche wird beigelegt (6.1a1): Ohne gebaute App gibt es keine Hülle.
// Seit 6.1a3a liest der Bau auch die vertrauten Signierer und k aus denselben
// Dateien wie die App – eine Liste, nie zwei, die auseinanderlaufen. Seit 6.1a3b
// nennt er die Kommandos der Hülle: Die App darf nur, was
// `capabilities/oberflaeche.json` ausdrücklich erlaubt.
use std::path::Path;

fn main() {
    let wurzel = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let app = wurzel.join("app/dist/freedom.html");
    println!("cargo:rerun-if-changed={}", app.display());
    if !app.exists() {
        panic!("packages/app/dist/freedom.html fehlt – zuerst `cd packages/app && node build.mjs`");
    }

    let signierer = wurzel.join("app/src/release-signierer.ts");
    let release = wurzel.join("protocol/src/release.ts");
    println!("cargo:rerun-if-changed={}", signierer.display());
    println!("cargo:rerun-if-changed={}", release.display());
    let vertraut = vertraute_signierer(&std::fs::read_to_string(&signierer).expect("release-signierer.ts fehlt"));
    let k = mindestens(&std::fs::read_to_string(&release).expect("release.ts fehlt"));
    let rs = format!(
        "/// Vertraute Signierer aus `packages/app/src/release-signierer.ts` (TRUSTED_SIGNERS).\npub const VERTRAUT: &[&str] = &[{}];\n/// k aus `packages/protocol/src/release.ts` (RELEASE_MIN_SIGNATUREN).\npub const K: usize = {k};\n",
        vertraut.iter().map(|s| format!("\"{s}\"")).collect::<Vec<_>>().join(", ")
    );
    std::fs::write(Path::new(&std::env::var("OUT_DIR").unwrap()).join("vertrauen.rs"), rs).unwrap();
    println!("cargo:rerun-if-env-changed=FREEDOM_RELEASED_AT");
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["oberflaeche_stand", "oberflaeche_installieren"])),
    )
    .expect("tauri-build");
}

/// Die 64-stelligen Hex-Schlüssel zwischen `TRUSTED_SIGNERS: string[] = [` und `];` – Kommentare zählen nicht.
fn vertraute_signierer(quelle: &str) -> Vec<String> {
    let anfang = quelle.find("export const TRUSTED_SIGNERS: string[] = [").expect("TRUSTED_SIGNERS nicht gefunden");
    let rest = &quelle[anfang..];
    let block = &rest[rest.find('[').unwrap() + 1..rest.find("];").expect("Ende von TRUSTED_SIGNERS nicht gefunden")];
    let mut aus = Vec::new();
    for zeile in block.lines() {
        let code = zeile.split("//").next().unwrap_or("");
        for teil in code.split('"').skip(1).step_by(2) {
            assert!(teil.len() == 64 && teil.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "kein Schlüssel in TRUSTED_SIGNERS: {teil}");
            aus.push(teil.to_string());
        }
    }
    aus
}

fn mindestens(quelle: &str) -> usize {
    let zeile = quelle.lines().find(|z| z.starts_with("export const RELEASE_MIN_SIGNATUREN = ")).expect("RELEASE_MIN_SIGNATUREN nicht gefunden");
    let k: usize = zeile.trim_start_matches("export const RELEASE_MIN_SIGNATUREN = ").trim_end_matches(';').trim().parse().expect("k ist keine Zahl");
    assert!(k >= 2, "k muss mindestens 2 sein");
    k
}
