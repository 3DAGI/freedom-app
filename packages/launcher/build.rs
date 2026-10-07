// Die Oberfläche wird beigelegt (6.1a1): Ohne gebaute App gibt es keine Hülle.
fn main() {
    let app = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/dist/freedom.html");
    println!("cargo:rerun-if-changed={}", app.display());
    if !app.exists() {
        panic!("packages/app/dist/freedom.html fehlt – zuerst `cd packages/app && node build.mjs`");
    }
    tauri_build::build()
}
