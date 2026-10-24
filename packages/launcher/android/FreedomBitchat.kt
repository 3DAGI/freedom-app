// FreedomStack – Bitchat über Bluetooth LE in der Android-Hülle (B-36b1, docs/BITCHAT-ENTWURF.md, BC-W1 A).
// B-36b1: Peripheral – Dienst anbieten, Bitchat-Geräte verbinden sich, schreiben und abonnieren Meldungen. Die Gegenrolle
// (selbst suchen und verbinden) folgt in B-36b2.
// Eigene Umsetzung nach dem gemeinfreien Swift-Code von Bitchat (BLEService, BLERadioController); EUPL-1.2 wie das Projekt.
//
// Die Klasse reicht nur Werte zwischen Bluetooth und der Hülle weiter – Pakete prüfen, zerlegen, verschlüsseln und
// weiterreichen tut die App mit den Bausteinen aus `packages/protocol` (bitchat-*.ts). Jeder Wert ist ein ganzes Paket
// (bitchatFuerVerbindung()): Werte über der Grenze einer Verbindung nimmt `sende()` nicht an, statt sie zu teilen.
// Gerufen wird nur über JNI aus Rust (`src/bitchat.rs`, ab B-36b2) – die Keep-Regel steht in `scripts/android-bitchat.py`.
package io.github.threedagi.freedom

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import java.io.ByteArrayOutputStream
import java.util.ArrayDeque
import java.util.UUID

@SuppressLint("MissingPermission") // geprüft in starte(): ohne die Rechte startet nichts
object FreedomBitchat {
    /** Dienst und Merkmal von Bitchat (Mainnet) – dieselben Werte nennt `docs/PROTOCOL.md` §45 */
    val DIENST: UUID = UUID.fromString("f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c")
    val MERKMAL: UUID = UUID.fromString("a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d")
    private val MELDEN: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** Ein Attribut fasst höchstens 512 Byte (ATT) – mehr nimmt auch ein langer Schreibvorgang nicht an */
    private const val WERT_MAX = 512
    private const val EINGANG_MAX = 512
    private const val AUSGANG_MAX = 64
    private const val ANFRAGE_RECHTE = 4736

    private class Verbindung(val id: String, val geraet: BluetoothDevice) {
        var grenze = 20
        var bereit = false
        var beschaeftigt = false
        val ausgang = ArrayDeque<ByteArray>()
    }

    private val sperre = Any()
    private val verbindungen = LinkedHashMap<String, Verbindung>()
    private val nachAdresse = HashMap<String, String>()
    private val vorbereitet = HashMap<String, ByteArrayOutputStream>()
    private val eingang = ArrayDeque<Pair<String, ByteArray>>()
    private var naechste = 1
    @Volatile private var aktiv = false
    @Volatile private var werbung = "aus"
    @Volatile private var kontext: Context? = null
    @Volatile private var server: BluetoothGattServer? = null
    @Volatile private var serverMerkmal: BluetoothGattCharacteristic? = null

    private fun rechte(): Array<String> =
        if (Build.VERSION.SDK_INT >= 31) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    private fun fehlende(k: Context): List<String> =
        rechte().filter { k.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private fun manager(k: Context): BluetoothManager? = k.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

    /**
     * Stand als JSON: `stand` ist `an`, `bereit` (aus, aber möglich), `erlaubnis` (Rechte fehlen), `ausgeschaltet`
     * (Bluetooth aus), `kein-anbieten` (das Gerät kann keinen Dienst anbieten) oder `kein-bluetooth`; `werbung` ist `an`,
     * `aus` oder `fehler`; dazu die Verbindungen, über die man senden kann, mit ihrer Grenze.
     */
    @JvmStatic
    fun stand(k: Context): String {
        val adapter = manager(k)?.adapter
        val wert = when {
            adapter == null -> "kein-bluetooth"
            fehlende(k).isNotEmpty() -> "erlaubnis"
            !adapter.isEnabled -> "ausgeschaltet"
            !adapter.isMultipleAdvertisementSupported -> "kein-anbieten"
            else -> if (aktiv) "an" else "bereit"
        }
        val liste = synchronized(sperre) {
            verbindungen.values.filter { it.bereit }.joinToString(",") { "{\"id\":\"${it.id}\",\"grenze\":${it.grenze}}" }
        }
        return "{\"stand\":\"$wert\",\"werbung\":\"$werbung\",\"verbindungen\":[$liste]}"
    }

    /** Startet Bluetooth – fragt erst nach den Rechten (dann `erlaubnis`; die App fragt den Stand später erneut). */
    @JvmStatic
    fun starte(activity: Activity): String {
        val fehlt = fehlende(activity)
        if (fehlt.isNotEmpty()) {
            activity.requestPermissions(fehlt.toTypedArray(), ANFRAGE_RECHTE)
            return "erlaubnis"
        }
        val m = manager(activity) ?: return "kein-bluetooth"
        val adapter = m.adapter ?: return "kein-bluetooth"
        if (!adapter.isEnabled) return "ausgeschaltet"
        if (!adapter.isMultipleAdvertisementSupported) return "kein-anbieten"
        synchronized(sperre) {
            if (aktiv) return "an"
            aktiv = true
            kontext = activity.applicationContext
        }
        if (!starteServer(m, activity.applicationContext)) {
            aktiv = false
            return "kein-anbieten"
        }
        starteWerbung(adapter)
        return "an"
    }

    /** Hält alles an und vergisst alle Verbindungen und alles, was noch wartete. */
    @JvmStatic
    fun stoppe() {
        val alte: List<Verbindung>
        synchronized(sperre) {
            if (!aktiv) return
            aktiv = false
            alte = verbindungen.values.toList()
            verbindungen.clear()
            nachAdresse.clear()
            vorbereitet.clear()
            eingang.clear()
        }
        kontext?.let { manager(it)?.adapter }?.bluetoothLeAdvertiser?.stopAdvertising(werbeRueckruf)
        for (v in alte) server?.cancelConnection(v.geraet)
        server?.close()
        server = null
        serverMerkmal = null
        werbung = "aus"
    }

    /** Nimmt einen Wert für eine Verbindung an – nur, wenn sie bereit ist und er in ihre Grenze passt. */
    @JvmStatic
    fun sende(id: String, wert: ByteArray): Boolean {
        synchronized(sperre) {
            val v = verbindungen[id] ?: return false
            if (!v.bereit || wert.isEmpty() || wert.size > v.grenze || v.ausgang.size >= AUSGANG_MAX) return false
            v.ausgang.addLast(wert.copyOf())
        }
        weiter(id)
        return true
    }

    /** Alles Empfangene seit dem letzten Abholen: je Wert Länge der Kennung (1), Kennung, Länge (2, groß), Wert. */
    @JvmStatic
    fun hole(): ByteArray {
        val aus = ByteArrayOutputStream()
        synchronized(sperre) {
            while (eingang.isNotEmpty()) {
                val (id, wert) = eingang.removeFirst()
                val kennung = id.toByteArray(Charsets.US_ASCII)
                aus.write(kennung.size)
                aus.write(kennung)
                aus.write(wert.size shr 8)
                aus.write(wert.size and 0xff)
                aus.write(wert)
            }
        }
        return aus.toByteArray()
    }

    // ---- Verbindungen ----

    private fun finde(rolle: String, geraet: BluetoothDevice): Verbindung? =
        nachAdresse[rolle + geraet.address]?.let { verbindungen[it] }

    private fun neu(rolle: String, geraet: BluetoothDevice): Verbindung {
        finde(rolle, geraet)?.let { return it }
        val v = Verbindung(rolle + naechste++, geraet)
        verbindungen[v.id] = v
        nachAdresse[rolle + geraet.address] = v.id
        return v
    }

    private fun entferne(rolle: String, geraet: BluetoothDevice) {
        synchronized(sperre) {
            val id = nachAdresse.remove(rolle + geraet.address) ?: return
            verbindungen.remove(id)
            vorbereitet.remove(geraet.address)
        }
    }

    private fun empfange(rolle: String, geraet: BluetoothDevice, wert: ByteArray?) {
        if (wert == null || wert.isEmpty() || wert.size > WERT_MAX) return
        synchronized(sperre) {
            if (!aktiv) return
            val v = neu(rolle, geraet)
            eingang.addLast(v.id to wert.copyOf())
            while (eingang.size > EINGANG_MAX) eingang.removeFirst()
        }
    }

    /** Schickt den nächsten Wert einer Verbindung – immer nur einen zugleich (Android erlaubt nicht mehr). */
    private fun weiter(id: String) {
        val v: Verbindung
        val wert: ByteArray
        synchronized(sperre) {
            v = verbindungen[id] ?: return
            if (v.beschaeftigt || !v.bereit) return
            wert = v.ausgang.pollFirst() ?: return
            v.beschaeftigt = true
        }
        if (!melde(v, wert)) fertig(id)
    }

    private fun fertig(id: String) {
        synchronized(sperre) { verbindungen[id]?.beschaeftigt = false }
        weiter(id)
    }

    @Suppress("DEPRECATION")
    private fun melde(v: Verbindung, wert: ByteArray): Boolean {
        val s = server ?: return false
        val m = serverMerkmal ?: return false
        return if (Build.VERSION.SDK_INT >= 33) {
            s.notifyCharacteristicChanged(v.geraet, m, false, wert) == BluetoothStatusCodes.SUCCESS
        } else {
            m.value = wert
            s.notifyCharacteristicChanged(v.geraet, m, false)
        }
    }

    // ---- Peripheral: Dienst, Werbung, Schreiben und Melden ----

    private fun starteServer(m: BluetoothManager, k: Context): Boolean {
        val s = m.openGattServer(k, serverRueckruf) ?: return false
        val merkmal = BluetoothGattCharacteristic(
            MERKMAL,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        merkmal.addDescriptor(
            BluetoothGattDescriptor(MELDEN, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE),
        )
        val dienst = BluetoothGattService(DIENST, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        dienst.addCharacteristic(merkmal)
        s.addService(dienst)
        server = s
        serverMerkmal = merkmal
        return true
    }

    /** Nur die Kennung des Dienstes, kein Gerätename – wie `advertisementData()` in Bitchat */
    private fun starteWerbung(adapter: android.bluetooth.BluetoothAdapter) {
        val werbung = adapter.bluetoothLeAdvertiser ?: return
        val einstellungen = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .build()
        val daten = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(DIENST))
            .build()
        werbung.startAdvertising(einstellungen, daten, werbeRueckruf)
    }

    private val werbeRueckruf = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            werbung = "an"
        }

        override fun onStartFailure(errorCode: Int) {
            werbung = "fehler"
        }
    }

    private val serverRueckruf = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) entferne("p", device)
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            synchronized(sperre) { if (aktiv) neu("p", device).grenze = minOf(mtu - 3, WERT_MAX) }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?,
        ) {
            if (descriptor.uuid == MELDEN && value != null) {
                val an = value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                val id = synchronized(sperre) { if (aktiv) neu("p", device).also { it.bereit = an }.id else null }
                if (an && id != null) weiter(id)
            }
            if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?,
        ) {
            var ok = characteristic.uuid == MERKMAL && value != null
            if (ok && preparedWrite) {
                synchronized(sperre) {
                    val puffer = vorbereitet.getOrPut(device.address) { ByteArrayOutputStream() }
                    ok = offset == puffer.size() && offset + value!!.size <= WERT_MAX
                    if (ok) puffer.write(value!!) else vorbereitet.remove(device.address)
                }
            } else if (ok) {
                empfange("p", device, value)
            }
            val antwort = if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_FAILURE
            if (responseNeeded) server?.sendResponse(device, requestId, antwort, offset, value)
        }

        override fun onExecuteWrite(device: BluetoothDevice, requestId: Int, execute: Boolean) {
            val puffer = synchronized(sperre) { vorbereitet.remove(device.address) }
            if (execute && puffer != null) empfange("p", device, puffer.toByteArray())
            server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
        }

        override fun onDescriptorReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor,
        ) {
            val an = synchronized(sperre) { finde("p", device)?.bereit == true }
            val wert = if (an) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, wert)
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic,
        ) {
            server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, ByteArray(0))
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            synchronized(sperre) { nachAdresse["p" + device.address] }?.let { fertig(it) }
        }
    }
}
