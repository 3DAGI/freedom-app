#!/usr/bin/env bash
# Referenz für das Bitchat-Paketformat (Schritt B-36a1) aus bitchat-android.
#
# Erzeugt packages/protocol/test/fixtures/bitchat-referenz.json mit dem Kodierer von
# bitchat-android am festen Commit. Nur zum Nachbauen der Referenz – weder Build noch Tests
# brauchen Kotlin oder Java:
#
#     bash scripts/bitchat-referenz.sh
#
# bitchat-android steht seit 28.02.2026 unter GPL-3.0 (BC-W1 A, docs/BITCHAT-ENTWURF.md): Der
# Code wird hier nur geladen, übersetzt und ausgeführt – nichts davon kommt ins Repository,
# nur die Bytes, die er ausgibt. Die Attrappen für Android (Parcelable, Log) braucht er nur,
# um außerhalb von Android zu übersetzen; sie ändern keine Byte-Logik.
#
# Braucht Java (17 oder neuer), git, curl, unzip; lädt kotlinc (rund 80 MB) mit fester Prüfsumme.
set -euo pipefail

KOTLIN=2.2.20
KOTLIN_SHA256=81f0264c9073b5cbbdb3ff8418cf2c5dac076879fc156fa1a6462f5a5acc4420
BITCHAT_ANDROID=dfc67dad41691128bc6e7425bd69f2f409cb5bbf
WURZEL=$(cd "$(dirname "$0")/.." && pwd)
ZIEL="$WURZEL/packages/protocol/test/fixtures/bitchat-referenz.json"

ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT

curl -fsSL -o "$ARBEIT/kotlin.zip" "https://github.com/JetBrains/kotlin/releases/download/v$KOTLIN/kotlin-compiler-$KOTLIN.zip"
echo "$KOTLIN_SHA256  $ARBEIT/kotlin.zip" | sha256sum -c --quiet -
unzip -q "$ARBEIT/kotlin.zip" -d "$ARBEIT"

QUELLE=app/src/main/java/com/bitchat/android
DATEIEN=(
  protocol/BinaryProtocol.kt protocol/MessagePadding.kt protocol/CompressionUtil.kt protocol/DecompressionResourcePool.kt
  util/AppConstants.kt model/FragmentPayload.kt model/IdentityAnnouncement.kt model/PeerCapabilities.kt
)
git init -q "$ARBEIT/ba"
git -C "$ARBEIT/ba" fetch -q --depth 1 https://github.com/permissionlesstech/bitchat-android.git "$BITCHAT_ANDROID"
test "$(git -C "$ARBEIT/ba" rev-parse FETCH_HEAD)" = "$BITCHAT_ANDROID"
git -C "$ARBEIT/ba" checkout -q FETCH_HEAD -- "${DATEIEN[@]/#/$QUELLE/}"

mkdir -p "$ARBEIT/attrappen"
cat > "$ARBEIT/attrappen/Android.kt" <<'KT'
@file:Suppress("unused")
package android.os
interface Parcelable
KT
cat > "$ARBEIT/attrappen/Log.kt" <<'KT'
package android.util
object Log {
    fun d(t: String, m: String): Int = 0
    fun i(t: String, m: String): Int = 0
    fun v(t: String, m: String): Int = 0
    fun w(t: String, m: String): Int = 0
    fun w(t: String, m: String, e: Throwable): Int = 0
    fun e(t: String, m: String): Int = 0
    fun e(t: String, m: String, e: Throwable): Int = 0
}
KT
cat > "$ARBEIT/attrappen/Parcelize.kt" <<'KT'
package kotlinx.parcelize
annotation class Parcelize
annotation class IgnoredOnParcel
KT

cat > "$ARBEIT/Referenz.kt" <<'KT'
import com.bitchat.android.model.FragmentPayload
import com.bitchat.android.model.IdentityAnnouncement
import com.bitchat.android.model.PeerCapabilities
import com.bitchat.android.model.UnknownAnnouncementTLV
import com.bitchat.android.protocol.BitchatPacket
import com.bitchat.android.protocol.MessagePadding

fun hex(b: ByteArray?): String = if (b == null) "null" else "\"" + b.joinToString("") { "%02x".format(it) } + "\""
fun muster(n: Int, s: Int) = ByteArray(n) { ((it * 37 + s) % 256).toByte() }
fun kennung(s: Int) = ByteArray(8) { (s + it).toByte() }

fun paket(fall: String, p: BitchatPacket): String {
    val route = p.route?.joinToString(",", "[", "]") { hex(it) } ?: "null"
    return """{"fall":"$fall","version":${p.version},"typ":${p.type},"ttl":${p.ttl},"zeit":${p.timestamp},""" +
        """"absender":${hex(p.senderID)},"empfaenger":${hex(p.recipientID)},"route":$route,""" +
        """"nutzlast":${hex(p.payload)},"signatur":${hex(p.signature)},""" +
        """"roh":${hex(p.toBinaryData(false))},"gepolstert":${hex(p.toBinaryData(true))},""" +
        """"signierDaten":${hex(p.toBinaryDataForSigning())}}"""
}

fun main() {
    val zeit = 1761220000000uL
    val pakete = listOf(
        paket("ankuendigung-v1", BitchatPacket(1u, 0x01u, kennung(1), null, zeit, muster(77, 1), null, 7u)),
        paket("gerichtet-signiert", BitchatPacket(1u, 0x11u, kennung(1), kennung(0x21), zeit, muster(200, 2), muster(64, 9), 7u)),
        paket("rundruf-leer", BitchatPacket(1u, 0x03u, kennung(5), null, zeit + 1uL, ByteArray(0), null, 3u)),
        paket("v2-route", BitchatPacket(2u, 0x11u, kennung(1), kennung(0x21), zeit, muster(300, 4), muster(64, 7), 6u,
            listOf(kennung(0x31), kennung(0x41)))),
        paket("v2-ohne-route", BitchatPacket(2u, 0x10u, kennung(2), kennung(0x22), zeit, muster(90, 5), null, 7u)),
        paket("gross", BitchatPacket(1u, 0x11u, kennung(1), kennung(0x21), zeit, muster(2100, 6), muster(64, 8), 7u)),
        // Komprimierbar: Bitchat packt selbst (raw deflate) – der Leser muss das erkennen, nicht entpacken
        paket("komprimiert", BitchatPacket(1u, 0x02u, kennung(3), null, zeit, ByteArray(300) { 0x61 }, null, 7u)),
    )
    val ankuendigungen = listOf(
        """{"fall":"ohne-faehigkeiten","name":"anon","hex":${hex(IdentityAnnouncement("anon", muster(32, 11), muster(32, 12), null).encode())}}""",
        """{"fall":"mit-faehigkeiten-und-nachbarn","name":"Ana ü","hex":${hex(IdentityAnnouncement("Ana ü", muster(32, 13), muster(32, 14),
            PeerCapabilities(0x1A4L), listOf(UnknownAnnouncementTLV(4, kennung(0x51) + kennung(0x61)))).encode())}}""",
    )
    val fragmente = listOf(
        """{"fall":"mitte","hex":${hex(FragmentPayload(kennung(0x40), 1, 3, 0x11u, muster(50, 3)).encode())}}""",
        """{"fall":"letztes","hex":${hex(FragmentPayload(kennung(0x48), 65534, 65535, 0x01u, muster(1, 0)).encode())}}""",
    )
    val polster = listOf(0, 10, 239, 240, 241, 400, 496, 497, 1000, 2032, 2033, 2100).joinToString(",") { n ->
        val roh = muster(n, n)
        """{"laenge":$n,"block":${MessagePadding.optimalBlockSize(n)},"gepolstert":${hex(MessagePadding.pad(roh, MessagePadding.optimalBlockSize(n)))}}"""
    }
    println("""{"quelle":"bitchat-android@BITCHAT_ANDROID","pakete":[${pakete.joinToString(",")}],""" +
        """"ankuendigungen":[${ankuendigungen.joinToString(",")}],"fragmente":[${fragmente.joinToString(",")}],"polster":[$polster]}""")
}
KT
sed -i "s/BITCHAT_ANDROID/$BITCHAT_ANDROID/" "$ARBEIT/Referenz.kt"

"$ARBEIT/kotlinc/bin/kotlinc" -nowarn -include-runtime -d "$ARBEIT/referenz.jar" \
  "$ARBEIT/Referenz.kt" "$ARBEIT"/attrappen/*.kt "${DATEIEN[@]/#/$ARBEIT/ba/$QUELLE/}" 2>"$ARBEIT/kotlinc.log" || { cat "$ARBEIT/kotlinc.log"; exit 1; }
java -jar "$ARBEIT/referenz.jar" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=1, ensure_ascii=False))' > "$ZIEL"
echo "geschrieben: ${ZIEL#$WURZEL/}"
