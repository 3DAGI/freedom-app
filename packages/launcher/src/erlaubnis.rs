//! Kamera und Mikrofon in der Hülle (6.1d): QR-Code scannen, Sprachnachricht, Anruf.
//!
//! Die App fragt beides nur auf Klick an („Kamera nur auf Klick“, „das Mikrofon nur aus
//! `starte()`“). Unter Linux lehnt WebKitGTK ohne Antwort still ab – eine Nachfrage gibt
//! es dort nicht –, deshalb erlaubt die Hülle beides, aber nur der eigenen Oberfläche.
//! Windows (WebView2) und Android fragen selbst nach; dort bleibt es bei `Default`,
//! Android braucht dafür die Rechte im Manifest (`scripts/android-rechte.py`). Alles
//! andere bleibt, wie das Webview es hält; fremde Seiten bekommen nichts.

use tauri::webview::{PermissionKind, PermissionResponse};

/// Antwort auf eine Anfrage nach `art` – `eigene`: die Seite ist die eigene Oberfläche
/// (`oberflaeche::darf_navigieren`).
pub fn antwort(art: PermissionKind, eigene: bool) -> PermissionResponse {
    if !eigene {
        return PermissionResponse::Deny;
    }
    let medien = matches!(art, PermissionKind::Camera | PermissionKind::Microphone);
    if medien && cfg!(target_os = "linux") {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ist(a: PermissionResponse, b: PermissionResponse) -> bool {
        std::mem::discriminant(&a) == std::mem::discriminant(&b)
    }

    #[test]
    fn kamera_und_mikrofon_fuer_die_eigene_oberflaeche() {
        let erwartet = if cfg!(target_os = "linux") { PermissionResponse::Allow } else { PermissionResponse::Default };
        assert!(ist(antwort(PermissionKind::Camera, true), erwartet));
        assert!(ist(antwort(PermissionKind::Microphone, true), erwartet));
    }

    #[test]
    fn anderes_bleibt_beim_webview_und_fremde_seiten_bekommen_nichts() {
        for art in [PermissionKind::Geolocation, PermissionKind::Notifications, PermissionKind::DisplayCapture, PermissionKind::ClipboardRead] {
            assert!(ist(antwort(art, true), PermissionResponse::Default), "{art:?}");
        }
        for art in [PermissionKind::Camera, PermissionKind::Microphone, PermissionKind::Geolocation] {
            assert!(ist(antwort(art, false), PermissionResponse::Deny), "{art:?}");
        }
    }
}
