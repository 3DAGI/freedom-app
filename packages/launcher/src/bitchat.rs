//! Bitchat über Bluetooth LE (B-36b3a, `docs/BITCHAT-ENTWURF.md`): die Kommandos, mit denen die App die Kotlin-Klasse
//! `FreedomBitchat` ruft (`android/FreedomBitchat.kt`, B-36b1/b2). Die Hülle prüft nur die Form – Kennung der
//! Verbindung, Größe des Werts –; Pakete prüft, zerlegt und verschlüsselt die App mit den Bausteinen des Protokolls.
//! Außer unter Android antwortet jedes Kommando mit dem Fehler `kein-android`.

use tauri::{Runtime, WebviewWindow};

/// Größter Wert je Schreiben oder Meldung – ein Attribut fasst höchstens 512 Byte (ATT).
pub const WERT_MAX: usize = 512;

/// Kennung einer Verbindung aus `FreedomBitchat`: `p` (Gerät hat sich verbunden) oder `z` (selbst verbunden) und eine Zahl.
pub fn kennung_ok(id: &str) -> bool {
    let zahl = id.strip_prefix('p').or_else(|| id.strip_prefix('z'));
    zahl.is_some_and(|z| (1..=9).contains(&z.len()) && z.bytes().all(|b| b.is_ascii_digit()))
}

/// Ein Wert, den die Hülle annimmt: nicht leer, höchstens `WERT_MAX` Byte (die Grenze der Verbindung prüft Kotlin).
pub fn wert_ok(wert: &[u8]) -> bool {
    !wert.is_empty() && wert.len() <= WERT_MAX
}

#[cfg(target_os = "android")]
mod jni_weg {
    use jni::objects::{JClass, JObject, JString, JValue};
    use jni::JNIEnv;
    use tauri::wry::prelude::find_class;
    use tauri::{Runtime, WebviewWindow};

    const KLASSE: &str = "io/github/threedagi/freedom/FreedomBitchat";

    /// Ruft `f` auf dem Thread des WebViews mit der Klasse und wartet auf das Ergebnis.
    pub async fn rufe<R: Runtime, T: Send + 'static>(
        fenster: &WebviewWindow<R>,
        f: impl FnOnce(&mut JNIEnv, &JObject, &JClass) -> jni::errors::Result<T> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        fenster
            .with_webview(move |pw| {
                pw.jni_handle().exec(move |env, activity, _webview| {
                    let erg = find_class(env, activity, KLASSE.into()).and_then(|k| f(env, activity, &k));
                    if env.exception_check().unwrap_or(false) {
                        let _ = env.exception_clear();
                    }
                    let _ = tx.send(erg.map_err(|_| "jni".to_string()));
                })
            })
            .map_err(|_| "fenster".to_string())?;
        rx.await.map_err(|_| "jni".to_string())?
    }

    pub fn text(env: &mut JNIEnv, o: JObject) -> jni::errors::Result<String> {
        Ok(env.get_string(&JString::from(o))?.into())
    }

    pub async fn stand<R: Runtime>(f: &WebviewWindow<R>) -> Result<String, String> {
        rufe(f, |env, a, k| {
            let s = env.call_static_method(k, "stand", "(Landroid/content/Context;)Ljava/lang/String;", &[JValue::Object(a)])?.l()?;
            text(env, s)
        })
        .await
    }

    pub async fn starte<R: Runtime>(f: &WebviewWindow<R>) -> Result<String, String> {
        rufe(f, |env, a, k| {
            let s = env.call_static_method(k, "starte", "(Landroid/app/Activity;)Ljava/lang/String;", &[JValue::Object(a)])?.l()?;
            text(env, s)
        })
        .await
    }

    pub async fn stoppe<R: Runtime>(f: &WebviewWindow<R>) -> Result<(), String> {
        rufe(f, |env, _, k| env.call_static_method(k, "stoppe", "()V", &[]).map(|_| ())).await
    }

    pub async fn sende<R: Runtime>(f: &WebviewWindow<R>, id: String, wert: Vec<u8>) -> Result<bool, String> {
        rufe(f, move |env, _, k| {
            let id = env.new_string(id)?;
            let wert = env.byte_array_from_slice(&wert)?;
            env.call_static_method(k, "sende", "(Ljava/lang/String;[B)Z", &[JValue::Object(&id), JValue::Object(&wert)])?.z()
        })
        .await
    }

    pub async fn hole<R: Runtime>(f: &WebviewWindow<R>) -> Result<Vec<u8>, String> {
        rufe(f, |env, _, k| {
            let d = env.call_static_method(k, "hole", "()[B", &[])?.l()?;
            env.convert_byte_array(jni::objects::JByteArray::from(d))
        })
        .await
    }
}

/// Stand als JSON aus `FreedomBitchat.stand()` – die App liest ihn streng (ab B-36b3b `leseBitchatStand()`).
#[tauri::command]
pub async fn bitchat_stand<R: Runtime>(fenster: WebviewWindow<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    return jni_weg::stand(&fenster).await;
    #[cfg(not(target_os = "android"))]
    return Err(kein_android(&fenster));
}

/// Startet Bluetooth – nur auf Klick der App; ohne Rechte fragt Android erst nach (`erlaubnis`).
#[tauri::command]
pub async fn bitchat_starten<R: Runtime>(fenster: WebviewWindow<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    return jni_weg::starte(&fenster).await;
    #[cfg(not(target_os = "android"))]
    return Err(kein_android(&fenster));
}

#[tauri::command]
pub async fn bitchat_stoppen<R: Runtime>(fenster: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return jni_weg::stoppe(&fenster).await;
    #[cfg(not(target_os = "android"))]
    return Err(kein_android(&fenster));
}

/// Ein ganzes Paket an eine Verbindung – `false`, wenn sie es nicht annimmt (nicht bereit, über ihrer Grenze, voll).
#[tauri::command]
pub async fn bitchat_senden<R: Runtime>(fenster: WebviewWindow<R>, id: String, wert: Vec<u8>) -> Result<bool, String> {
    if !kennung_ok(&id) || !wert_ok(&wert) {
        return Err("form".into());
    }
    #[cfg(target_os = "android")]
    return jni_weg::sende(&fenster, id, wert).await;
    #[cfg(not(target_os = "android"))]
    return Err(kein_android(&fenster));
}

/// Alles Empfangene seit dem letzten Abholen, als Bytes (je Wert: Länge der Kennung, Kennung, Länge, Wert).
#[tauri::command]
pub async fn bitchat_holen<R: Runtime>(fenster: WebviewWindow<R>) -> Result<tauri::ipc::Response, String> {
    #[cfg(target_os = "android")]
    return jni_weg::hole(&fenster).await.map(tauri::ipc::Response::new);
    #[cfg(not(target_os = "android"))]
    return Err(kein_android(&fenster));
}

#[cfg(not(target_os = "android"))]
fn kein_android<R: Runtime>(_: &WebviewWindow<R>) -> String {
    "kein-android".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kennungen_wie_kotlin_sie_vergibt() {
        for id in ["p1", "z1", "z42", "p123456789"] {
            assert!(kennung_ok(id), "{id}");
        }
        for id in ["", "p", "x1", "P1", "p-1", "p1a", "z1234567890", "pp1", " p1", "p١", "١p1"] {
            assert!(!kennung_ok(id), "{id:?}");
        }
    }

    #[test]
    fn werte_nur_bis_512_byte() {
        assert!(wert_ok(&[1]));
        assert!(wert_ok(&[0; WERT_MAX]));
        assert!(!wert_ok(&[]));
        assert!(!wert_ok(&[0; WERT_MAX + 1]));
    }
}
