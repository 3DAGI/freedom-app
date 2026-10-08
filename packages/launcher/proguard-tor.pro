# 6.1b2a: androidx.webkit ruft nur die Hülle über JNI aus Rust auf (src/android_tor.rs) –
# R8 sähe die Klassen sonst als unbenutzt und entfernte sie; dann bliebe die App mit Tor
# auf der Warteseite. Die CI legt diese Datei nach `tauri android init` nach
# gen/android/app/ (dort liest der Release-Build jede *.pro).
-keep class androidx.webkit.** { *; }
