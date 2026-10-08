//! Tor unter Android (6.1b2a): der Proxy für die WebViews der App.
//!
//! wry setzt unter Android keinen Proxy; androidx.webkit kann es (`ProxyController`,
//! Merkmal `PROXY_OVERRIDE`) – für alle WebViews der App zugleich, über JNI ohne eigene
//! Java-Klassen. Damit vorher nichts hinausgeht, öffnet das Fenster mit Tor erst die
//! Warteseite der Hülle (`oberflaeche::WARTESEITE`, ohne Netz) und lädt die App erst,
//! wenn androidx.webkit meldet, dass der Proxy gilt. Klappt das nicht, bleibt die
//! Warteseite – nie lädt die App dann direkt; der Ausweg „direkt verbinden“ geht nur
//! per Klick. Ohne Tor prüft die Hülle nur, ob es ginge (für den Schalter der App).

use crate::netz::Netz;
use crate::oberflaeche;
use jni::objects::{GlobalRef, JObject, JValue};
use jni::{JNIEnv, JavaVM};
use std::time::Duration;
use tauri::wry::prelude::find_class;
use tauri::{Manager, Runtime, WebviewWindow};

/// So lange darf das Setzen des Proxys dauern.
const FRIST: Duration = Duration::from_secs(15);

/// Kann dieses WebView einen Proxy bekommen? (`WebViewFeature.isFeatureSupported`)
fn proxy_moeglich(env: &mut JNIEnv, activity: &JObject) -> jni::errors::Result<bool> {
    let merkmal = find_class(env, activity, "androidx/webkit/WebViewFeature".into())?;
    let name = env.new_string("PROXY_OVERRIDE")?;
    env.call_static_method(&merkmal, "isFeatureSupported", "(Ljava/lang/String;)Z", &[JValue::Object(&name)])?.z()
}

/// Setzt `regel` als Proxy aller WebViews dieser App – ohne eigene Ausnahmen (nur die des
/// WebViews selbst für localhost). Liefert die Zusage, die erfüllt ist, wenn er gilt, und
/// den Ausführer, der sie erfüllt.
fn setze_proxy(env: &mut JNIEnv, activity: &JObject, regel: &str) -> jni::errors::Result<(GlobalRef, GlobalRef)> {
    let bauer_klasse = find_class(env, activity, "androidx/webkit/ProxyConfig$Builder".into())?;
    let bauer = env.new_object(&bauer_klasse, "()V", &[])?;
    let regel = env.new_string(regel)?;
    env.call_method(&bauer, "addProxyRule", "(Ljava/lang/String;)Landroidx/webkit/ProxyConfig$Builder;", &[JValue::Object(&regel)])?;
    let konfig = env.call_method(&bauer, "build", "()Landroidx/webkit/ProxyConfig;", &[])?.l()?;
    // Ausführer und Zusage aus der Java-Bibliothek: eine FutureTask um einen leeren Thread
    let ausfuehrer = env
        .call_static_method("java/util/concurrent/Executors", "newSingleThreadExecutor", "()Ljava/util/concurrent/ExecutorService;", &[])?
        .l()?;
    let nichts = env.new_object("java/lang/Thread", "()V", &[])?;
    let zusage = env.new_object(
        "java/util/concurrent/FutureTask",
        "(Ljava/lang/Runnable;Ljava/lang/Object;)V",
        &[JValue::Object(&nichts), JValue::Object(&JObject::null())],
    )?;
    let steuer_klasse = find_class(env, activity, "androidx/webkit/ProxyController".into())?;
    let steuer = env.call_static_method(&steuer_klasse, "getInstance", "()Landroidx/webkit/ProxyController;", &[])?.l()?;
    env.call_method(
        &steuer,
        "setProxyOverride",
        "(Landroidx/webkit/ProxyConfig;Ljava/util/concurrent/Executor;Ljava/lang/Runnable;)V",
        &[JValue::Object(&konfig), JValue::Object(&ausfuehrer), JValue::Object(&zusage)],
    )?;
    Ok((env.new_global_ref(zusage)?, env.new_global_ref(ausfuehrer)?))
}

/// Wartet (eigener Thread) höchstens `FRIST`, bis der Proxy gilt.
fn warte(vm: &JavaVM, zusage: &GlobalRef, ausfuehrer: &GlobalRef) -> bool {
    let Ok(mut env) = vm.attach_current_thread() else { return false };
    let gilt = (|| -> jni::errors::Result<()> {
        let sekunden = env.get_static_field("java/util/concurrent/TimeUnit", "SECONDS", "Ljava/util/concurrent/TimeUnit;")?.l()?;
        let frist = JValue::Long(FRIST.as_secs() as i64);
        env.call_method(zusage.as_obj(), "get", "(JLjava/util/concurrent/TimeUnit;)Ljava/lang/Object;", &[frist, JValue::Object(&sekunden)])?;
        Ok(())
    })()
    .is_ok();
    raeume_auf(&mut env);
    let _ = env.call_method(ausfuehrer.as_obj(), "shutdown", "()V", &[]);
    raeume_auf(&mut env);
    gilt
}

/// Eine offene Java-Ausnahme (Zeitablauf, fehlende Klasse) beenden, bevor JNI weitergeht.
fn raeume_auf(env: &mut JNIEnv) {
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
}

/// Nach dem Bauen des Fensters: prüfen, ob ein Proxy ginge; mit Tor ihn setzen und erst
/// dann die App laden – sonst bleibt die Warteseite und der Stand sagt `proxy`.
pub fn richte_ein<R: Runtime>(fenster: &WebviewWindow<R>) -> tauri::Result<()> {
    let app = fenster.app_handle().clone();
    let regel = app.state::<Netz>().proxy_regel();
    let ziel = fenster.clone();
    fenster.with_webview(move |pw| {
        pw.jni_handle().exec(move |env, activity, _webview| {
            let netz = app.state::<Netz>();
            let moeglich = proxy_moeglich(env, activity).unwrap_or(false);
            raeume_auf(env);
            netz.proxy_moeglich(moeglich);
            let Some(regel) = regel else { return };
            let gesetzt = if moeglich { setze_proxy(env, activity, &regel).ok() } else { None };
            raeume_auf(env);
            match (gesetzt, env.get_java_vm()) {
                (Some((zusage, ausfuehrer)), Ok(vm)) => {
                    std::thread::spawn(move || {
                        let geladen = warte(&vm, &zusage, &ausfuehrer)
                            && oberflaeche::adresse().parse().ok().is_some_and(|url| ziel.navigate(url).is_ok());
                        if !geladen {
                            ziel.app_handle().state::<Netz>().proxy_gescheitert();
                        }
                    });
                }
                _ => netz.proxy_gescheitert(),
            }
        })
    })
}
