//! MLS nach Marmot für FreedomStack (Schritt 2.2b): die MDK-Engine im Browser.
//!
//! Den Identitätsschlüssel hält die App, nie dieses Modul. Es ruft nur zurück:
//! - `beweis(eventJson) -> sigHex` (synchron): der Kontobeweis im KeyPackage
//!   (Kind 450, von MDK gebaut; die App prüft Art und Id, bevor sie signiert);
//! - `signer.signEvent(json)`, `signer.nip44Encrypt(pk, text)`,
//!   `signer.nip44Decrypt(pk, text)` (Promises): Einladungen im Umschlag (NIP-59).
//!
//! Gruppennachrichten (Kind 445) signiert MDK mit einem frischen Schlüssel je
//! Nachricht. Der Zustand liegt in SQLite im Speicher; `zustand()` liefert die
//! Bytes, die die App verschlüsselt im Tresor ablegt.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Arc;
use std::task::{Context, Poll};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use cgka_engine::account_identity_proof::{AccountIdentityProofRequest, AccountIdentityProofSigner};
use cgka_engine::key_package::key_package_metadata;
use cgka_engine::{Engine, EngineBuilder};
use cgka_engine::feature_registry::FeatureRegistry;
use cgka_traits::app_components::{
    AGENT_TEXT_STREAM_QUIC_COMPONENT_ID, AppComponentData, GROUP_AVATAR_URL_COMPONENT_ID, GROUP_BLOSSOM_IMAGE_COMPONENT_ID,
    GROUP_ENCRYPTED_MEDIA_V1_COMPONENT_ID, GROUP_ENCRYPTED_MEDIA_V2_COMPONENT_ID, GROUP_MESSAGE_RETENTION_COMPONENT_ID,
    NOSTR_ROUTING_COMPONENT_ID, NostrRoutingV1, default_group_components, encode_nostr_routing_v1,
};
use cgka_traits::capabilities::{Capability, CapabilityRequirement, Feature, RequirementLevel};
use cgka_traits::app_event::{MARMOT_APP_EVENT_KIND_CHAT, MarmotAppEvent};
use cgka_traits::engine::{CgkaEngine, CreateGroupRequest, GroupEvent, KeyPackage, SendIntent, SendResult};
use cgka_traits::group::ProtocolProfile;
use cgka_traits::ingest::IngestOutcome;
use cgka_traits::transport::TransportMessage;
use cgka_traits::types::{GroupId, MemberId, MessageId};
use cgka_traits::PendingStateRef;
use js_sys::{Array, Function, Promise, Reflect};
use nostr::prelude::{Event, PublicKey, UnsignedEvent};
use serde::Serialize;
use storage_sqlite::SqliteAccountStorage;
use transport_nostr_peeler::{MarmotNostrSigner, MarmotSignerError, NostrMlsPeeler, NostrTransportEvent, SignerFuture};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};

const KIND_KEY_PACKAGE: u16 = 30_443;

// ------------------------------------------------------------- JS-Brücken

/// wasm32 ohne Threads: JS-Werte laufen nur auf dem einen Thread, auf dem sie
/// entstanden. Die Engine verlangt `Send`/`Sync` für Signer und Futures.
struct EinThread<T>(T);
unsafe impl<T> Send for EinThread<T> {}
unsafe impl<T> Sync for EinThread<T> {}
impl<F: Future> Future for EinThread<F> {
    type Output = F::Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<F::Output> {
        unsafe { self.map_unchecked_mut(|s| &mut s.0) }.poll(cx)
    }
}

fn js_text(v: JsValue) -> String {
    v.as_string().unwrap_or_else(|| format!("{v:?}"))
}

async fn rufe(obj: &JsValue, name: &str, args: &[&str]) -> Result<String, MarmotSignerError> {
    let f: Function = Reflect::get(obj, &JsValue::from_str(name))
        .ok()
        .and_then(|f| f.dyn_into().ok())
        .ok_or_else(|| MarmotSignerError::new(format!("Signer kann {name} nicht")))?;
    let argv: Array = args.iter().map(|a| JsValue::from_str(a)).collect();
    let r = f.apply(obj, &argv).map_err(|e| MarmotSignerError::new(js_text(e)))?;
    let v = JsFuture::from(Promise::resolve(&r)).await.map_err(|e| MarmotSignerError::new(js_text(e)))?;
    v.as_string().ok_or_else(|| MarmotSignerError::new(format!("{name}: keine Zeichenkette")))
}

/// Signer der Identität – die Aufrufe gehen an den Signer der App (auch NIP-46).
struct JsSigner {
    pk: PublicKey,
    obj: EinThread<JsValue>,
}
impl fmt::Debug for JsSigner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "JsSigner({})", self.pk.to_hex())
    }
}
impl MarmotNostrSigner for JsSigner {
    fn get_public_key(&self) -> SignerFuture<'_, Result<PublicKey, MarmotSignerError>> {
        let pk = self.pk;
        Box::pin(async move { Ok(pk) })
    }
    fn sign_event(&self, unsigned: UnsignedEvent) -> SignerFuture<'_, Result<Event, MarmotSignerError>> {
        let obj = self.obj.0.clone();
        Box::pin(EinThread(async move {
            let json = rufe(&obj, "signEvent", &[&unsigned.as_json()]).await?;
            let ev = Event::from_json(json).map_err(|e| MarmotSignerError::new(e.to_string()))?;
            ev.verify().map_err(|_| MarmotSignerError::new("Signatur ungültig"))?;
            Ok(ev)
        }))
    }
    fn nip04_encrypt<'a>(&'a self, _: &'a PublicKey, _: &'a str) -> SignerFuture<'a, Result<String, MarmotSignerError>> {
        Box::pin(async { Err(MarmotSignerError::new("NIP-04 wird nicht benutzt")) })
    }
    fn nip04_decrypt<'a>(&'a self, _: &'a PublicKey, _: &'a str) -> SignerFuture<'a, Result<String, MarmotSignerError>> {
        Box::pin(async { Err(MarmotSignerError::new("NIP-04 wird nicht benutzt")) })
    }
    fn nip44_encrypt<'a>(&'a self, pk: &'a PublicKey, text: &'a str) -> SignerFuture<'a, Result<String, MarmotSignerError>> {
        let (obj, pk, text) = (self.obj.0.clone(), pk.to_hex(), text.to_string());
        Box::pin(EinThread(async move { rufe(&obj, "nip44Encrypt", &[&pk, &text]).await }))
    }
    fn nip44_decrypt<'a>(&'a self, pk: &'a PublicKey, text: &'a str) -> SignerFuture<'a, Result<String, MarmotSignerError>> {
        let (obj, pk, text) = (self.obj.0.clone(), pk.to_hex(), text.to_string());
        Box::pin(EinThread(async move { rufe(&obj, "nip44Decrypt", &[&pk, &text]).await }))
    }
}

/// Kontobeweis: MDK baut das Event (Kind 450), die App prüft und signiert synchron.
struct JsBeweis(EinThread<Function>);
impl AccountIdentityProofSigner for JsBeweis {
    fn sign_account_identity_proof(&self, r: &AccountIdentityProofRequest) -> Result<[u8; 64], String> {
        let json = r.proof_event_json()?;
        let sig = self.0.0.call1(&JsValue::NULL, &JsValue::from_str(&json)).map_err(js_text)?;
        let sig = hex::decode(sig.as_string().ok_or("Beweis: keine Zeichenkette")?).map_err(|_| "Beweis: kein Hex")?;
        sig.try_into().map_err(|_| "Beweis: nicht 64 Byte".to_string())
    }
}

/// Uhr für `nostr` (universal-time) – im Browser aus der Uhr des Browsers.
struct Uhr;
impl universal_time::WallClock for Uhr {
    fn system_time(&self) -> universal_time::SystemTime {
        let d = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).unwrap_or_default();
        universal_time::SystemTime::from_unix_duration(d)
    }
}
impl universal_time::MonotonicClock for Uhr {
    fn instant(&self) -> universal_time::Instant {
        thread_local! { static START: web_time::Instant = web_time::Instant::now(); }
        universal_time::Instant::from_ticks(START.with(|s| s.elapsed()))
    }
}
universal_time::define_time_provider!(Uhr);

// ------------------------------------------------------------- Fähigkeiten

/// Wie MDKs eigene App (marmot-app) – sonst lehnen Gruppen aus White Noise
/// unsere KeyPackages ab. Komponenten, die die App nicht anzeigt, bewahrt die
/// Engine trotzdem korrekt im Gruppenzustand.
fn komponenten() -> Vec<u16> {
    let mut k = default_group_components();
    for id in [
        GROUP_BLOSSOM_IMAGE_COMPONENT_ID, NOSTR_ROUTING_COMPONENT_ID, GROUP_MESSAGE_RETENTION_COMPONENT_ID,
        AGENT_TEXT_STREAM_QUIC_COMPONENT_ID, GROUP_AVATAR_URL_COMPONENT_ID, GROUP_ENCRYPTED_MEDIA_V1_COMPONENT_ID,
        GROUP_ENCRYPTED_MEDIA_V2_COMPONENT_ID,
    ] {
        k.insert(id);
    }
    k.into_iter().collect()
}

fn merkmale() -> FeatureRegistry {
    let mut r = FeatureRegistry::new();
    r.register(
        Feature("self-remove"),
        CapabilityRequirement { requires: Capability::Proposal(10), level: RequirementLevel::Required, description: "MIP-03 SelfRemove" },
    );
    r
}

// ------------------------------------------------------------- Hilfen

fn fehler(e: impl fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn gruppe(hex_id: &str) -> Result<GroupId, JsValue> {
    hex::decode(hex_id).map(GroupId::new).map_err(|_| fehler("Gruppen-Id ungültig"))
}

fn json<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
    serde_json::to_string(v).map(|s| JsValue::from_str(&s)).map_err(fehler)
}

/// Transport-Nachricht der Engine → signiertes Nostr-Event (JSON), bereit zum Senden.
fn als_event(m: &TransportMessage) -> Result<String, JsValue> {
    let ev = NostrTransportEvent::from_transport_message(m).map_err(fehler)?;
    ev.to_verified_nostr_event().map_err(fehler)?;
    serde_json::to_string(&ev).map_err(fehler)
}

/// Nostr-Event (JSON) → Transport-Nachricht; Signatur und Id werden geprüft.
fn aus_event(json: &str) -> Result<TransportMessage, JsValue> {
    let ev: NostrTransportEvent = serde_json::from_str(json).map_err(fehler)?;
    ev.to_verified_nostr_event().map_err(fehler)?;
    ev.to_transport_message().map_err(fehler)
}

/// KeyPackage-Event eines Kontakts (Kind 30443, signiert) → KeyPackage mit Herkunft.
fn key_package(json: &str) -> Result<KeyPackage, JsValue> {
    let ev = Event::from_json(json).map_err(fehler)?;
    ev.verify().map_err(|_| fehler("KeyPackage: Signatur ungültig"))?;
    if ev.kind.as_u16() != KIND_KEY_PACKAGE {
        return Err(fehler("KeyPackage: falsche Art"));
    }
    let bytes = B64.decode(ev.content.as_bytes()).map_err(|_| fehler("KeyPackage: kein Base64"))?;
    let kp = KeyPackage::with_source_event_id(bytes, MessageId::new(ev.id.to_bytes().to_vec()))
        .with_protocol_profile(ProtocolProfile::Current);
    let meta = key_package_metadata(&kp).map_err(fehler)?;
    if meta.credential_identity_hex != ev.pubkey.to_hex() {
        return Err(fehler("KeyPackage: gehört nicht dem Absender"));
    }
    Ok(kp)
}

#[derive(Serialize)]
struct Nachricht {
    gruppe: String,
    von: String,
    text: String,
    zeit: u64,
    id: String,
}

#[derive(Serialize, Default)]
struct Ergebnis {
    /// `verarbeitet`, `gepuffert`, `ignoriert`, `entfernt`, `veraltet`, `abgelehnt`, …
    ergebnis: String,
    nachrichten: Vec<Nachricht>,
    /// Gruppen, deren Zustand sich änderte (Mitglieder, Epoche).
    geaendert: Vec<String>,
}

#[derive(Serialize)]
struct Veroeffentlichen {
    /// Signierte Nostr-Events (JSON) in dieser Reihenfolge senden.
    events: Vec<String>,
    /// Nach dem Senden `bestaetigt(ausstehend)` bzw. `gescheitert(ausstehend)` rufen.
    ausstehend: Option<String>,
    /// Einladungen (Kind 1059) an die neuen Mitglieder.
    einladungen: Vec<String>,
}

fn ergebnis_name(o: &IngestOutcome) -> String {
    let s = format!("{o:?}");
    s.split([' ', '{', '(']).next().unwrap_or("").to_string()
}

// ------------------------------------------------------------- Konto

struct Innen {
    engine: Engine<SqliteAccountStorage>,
    speicher: SqliteAccountStorage,
    ausstehend: HashMap<String, PendingStateRef>,
}

/// Ein MLS-Konto (eine Identität auf diesem Gerät).
#[wasm_bindgen]
pub struct MlsKonto {
    innen: Rc<RefCell<Option<Innen>>>,
    ich: String,
}

impl MlsKonto {
    /// Führt `f` mit exklusivem Zugriff aus; ein zweiter Aufruf während einer
    /// laufenden Operation wird abgewiesen statt verschränkt.
    fn mit<F, Fut>(&self, f: F) -> Promise
    where
        F: FnOnce(Innen) -> Fut + 'static,
        Fut: Future<Output = (Innen, Result<JsValue, JsValue>)> + 'static,
    {
        let zelle = self.innen.clone();
        future_to_promise(async move {
            let innen = zelle.borrow_mut().take().ok_or_else(|| fehler("MLS beschäftigt"))?;
            let (innen, r) = f(innen).await;
            *zelle.borrow_mut() = Some(innen);
            r
        })
    }

    fn lies<T>(&self, f: impl FnOnce(&mut Innen) -> Result<T, JsValue>) -> Result<T, JsValue> {
        let mut b = self.innen.borrow_mut();
        f(b.as_mut().ok_or_else(|| fehler("MLS beschäftigt"))?)
    }
}

#[wasm_bindgen]
impl MlsKonto {
    /// `identitaet`: eigener öffentlicher Schlüssel (hex); `beweis`, `signer`:
    /// siehe Modulbeschreibung; `zustand`: Bytes aus `zustand()` oder leer.
    #[wasm_bindgen(constructor)]
    pub fn new(identitaet: &str, beweis: Function, signer: JsValue, zustand: Option<Vec<u8>>) -> Result<MlsKonto, JsValue> {
        let pk = PublicKey::from_hex(identitaet).map_err(|_| fehler("Identität ungültig"))?;
        let speicher = match zustand {
            Some(b) if !b.is_empty() => SqliteAccountStorage::in_memory_from_bytes(&b),
            _ => SqliteAccountStorage::in_memory(),
        }
        .map_err(fehler)?;
        let signer: Arc<dyn MarmotNostrSigner> = Arc::new(JsSigner { pk, obj: EinThread(signer) });
        let mut engine = EngineBuilder::new(speicher.clone())
            .identity(pk.to_bytes().to_vec())
            .account_identity_proof_signer(Arc::new(JsBeweis(EinThread(beweis))))
            .feature_registry(merkmale())
            .supported_app_components(komponenten())
            .peeler(Box::new(NostrMlsPeeler::new().with_welcome_signer_arc(signer)))
            .build()
            .map_err(fehler)?;
        engine.hydrate_all_stored_groups().map_err(fehler)?;
        Ok(MlsKonto { innen: Rc::new(RefCell::new(Some(Innen { engine, speicher, ausstehend: HashMap::new() }))), ich: pk.to_hex() })
    }

    /// Ganzer Zustand als Bytes – für den Tresor der App.
    pub fn zustand(&self) -> Result<Vec<u8>, JsValue> {
        self.lies(|i| i.speicher.export_bytes().map_err(fehler))
    }

    /// Unsigniertes KeyPackage-Event (Kind 30443) als JSON; die App signiert
    /// und veröffentlicht es. `platz`: d-Tag dieses Geräts.
    #[wasm_bindgen(js_name = keyPackageEvent)]
    pub fn key_package_event(&self, platz: String) -> Promise {
        let ich = self.ich.clone();
        self.mit(move |mut i| async move {
            let r = async {
                let kp = i.engine.fresh_key_package().await.map_err(fehler)?;
                let m = key_package_metadata(&kp).map_err(fehler)?;
                let hexe = |v: &[u16]| v.iter().map(|x| format!("0x{x:04x}")).collect::<Vec<_>>();
                let mut tags = vec![
                    vec!["d".to_string(), platz],
                    vec!["mls_protocol_version".into(), "1.0".into()],
                    vec!["i".into(), m.key_package_ref_hex.clone()],
                    vec!["mls_ciphersuite".into(), format!("0x{:04x}", m.ciphersuite)],
                ];
                for (name, werte) in [("mls_extensions", hexe(&m.mls_extensions)), ("mls_proposals", hexe(&m.mls_proposals)), ("app_components", hexe(&m.app_components))] {
                    let mut t = vec![name.to_string()];
                    t.extend(werte);
                    tags.push(t);
                }
                let created_at = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_err(fehler)?.as_secs();
                json(&serde_json::json!({ "pubkey": ich, "created_at": created_at, "kind": KIND_KEY_PACKAGE, "tags": tags, "content": B64.encode(kp.bytes()) }))
            }
            .await;
            (i, r)
        })
    }

    /// Gruppe mit den Kontakten aus ihren KeyPackage-Events anlegen; `relays`:
    /// wo die Gruppe ihre Nachrichten austauscht (steht verschlüsselt im
    /// Gruppenzustand). Ergebnis: `{ gruppe, einladungen: [event] }` – die
    /// Gruppe steht sofort.
    #[wasm_bindgen(js_name = gruppeAnlegen)]
    pub fn gruppe_anlegen(&self, name: String, key_packages: Vec<String>, relays: Vec<String>) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let members = key_packages.iter().map(|k| key_package(k)).collect::<Result<Vec<_>, _>>()?;
                let routing = NostrRoutingV1::new(rand::random::<[u8; 32]>(), relays).map_err(fehler)?;
                let app_components = vec![AppComponentData { component_id: NOSTR_ROUTING_COMPONENT_ID, data: encode_nostr_routing_v1(&routing).map_err(fehler)? }];
                let (gid, res) = i
                    .engine
                    .create_group(CreateGroupRequest { name, description: String::new(), members, required_features: vec![], app_components, initial_admins: vec![] })
                    .await
                    .map_err(fehler)?;
                let welcomes = match res {
                    SendResult::FoundingGroupCreated { welcomes } => welcomes,
                    anders => return Err(fehler(format!("unerwartet: {anders:?}"))),
                };
                let einladungen = welcomes.iter().map(als_event).collect::<Result<Vec<_>, _>>()?;
                json(&serde_json::json!({ "gruppe": hex::encode(gid.as_slice()), "einladungen": einladungen }))
            }
            .await;
            (i, r)
        })
    }

    /// Einladung (Kind 1059) annehmen; gibt die Gruppen-Id zurück.
    pub fn beitreten(&self, einladung: String) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let gid = i.engine.join_welcome(aus_event(&einladung)?).await.map_err(fehler)?;
                Ok(JsValue::from_str(&hex::encode(gid.as_slice())))
            }
            .await;
            (i, r)
        })
    }

    /// Text in die Gruppe; Ergebnis wie bei `einladen` (Nachricht braucht keine Bestätigung).
    pub fn senden(&self, gruppe_id: String, text: String) -> Promise {
        let ich = self.ich.clone();
        self.mit(move |mut i| async move {
            let r = async {
                let gid = gruppe(&gruppe_id)?;
                let jetzt = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_err(fehler)?.as_secs();
                let payload = MarmotAppEvent::new(ich, jetzt, MARMOT_APP_EVENT_KIND_CHAT, vec![], text).encode().map_err(fehler)?;
                let res = i.engine.send(SendIntent::AppMessage { group_id: gid, payload, expected_epoch: None }).await.map_err(fehler)?;
                veroeffentlichen(&mut i, res)
            }
            .await;
            (i, r)
        })
    }

    /// Kontakte einladen (KeyPackage-Events).
    pub fn einladen(&self, gruppe_id: String, key_packages: Vec<String>) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let kps = key_packages.iter().map(|k| key_package(k)).collect::<Result<Vec<_>, _>>()?;
                let res = i.engine.send(SendIntent::Invite { group_id: gruppe(&gruppe_id)?, key_packages: kps, initial_admins: vec![] }).await.map_err(fehler)?;
                veroeffentlichen(&mut i, res)
            }
            .await;
            (i, r)
        })
    }

    /// Mitglieder (Identitäten hex) entfernen – sie lesen danach nichts mehr.
    pub fn entfernen(&self, gruppe_id: String, mitglieder: Vec<String>) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let members = mitglieder.iter().map(|m| hex::decode(m).map(MemberId::new).map_err(|_| fehler("Mitglied ungültig"))).collect::<Result<Vec<_>, _>>()?;
                let res = i.engine.send(SendIntent::RemoveMembers { group_id: gruppe(&gruppe_id)?, members }).await.map_err(fehler)?;
                veroeffentlichen(&mut i, res)
            }
            .await;
            (i, r)
        })
    }

    /// Nach dem Senden: Relays haben angenommen.
    pub fn bestaetigt(&self, ausstehend: String) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let p = i.ausstehend.remove(&ausstehend).ok_or_else(|| fehler("unbekannt"))?;
                i.engine.confirm_published(p).await.map_err(fehler)?;
                Ok(JsValue::UNDEFINED)
            }
            .await;
            (i, r)
        })
    }

    /// Nach dem Senden: kein Relay nahm an – die Gruppe bleibt, wie sie war.
    pub fn gescheitert(&self, ausstehend: String) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let p = i.ausstehend.remove(&ausstehend).ok_or_else(|| fehler("unbekannt"))?;
                i.engine.publish_failed(p).await.map_err(fehler)?;
                Ok(JsValue::UNDEFINED)
            }
            .await;
            (i, r)
        })
    }

    /// Ein empfangenes Event (Kind 445 oder 1059) verarbeiten.
    pub fn empfangen(&self, event: String) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let m = aus_event(&event)?;
                let mut e = Ergebnis::default();
                if matches!(m.envelope, cgka_traits::transport::TransportEnvelope::Welcome { .. }) {
                    let gid = i.engine.join_welcome(m).await.map_err(fehler)?;
                    e.ergebnis = "beigetreten".into();
                    e.geaendert.push(hex::encode(gid.as_slice()));
                } else {
                    let o = i.engine.ingest(m).await.map_err(fehler)?;
                    e.ergebnis = ergebnis_name(&o);
                }
                sammle(&mut i, &mut e);
                json(&e)
            }
            .await;
            (i, r)
        })
    }

    /// Wie lange warten, bis `fortschreiten` sinnvoll ist (ms); `undefined` = nichts offen.
    pub fn wartezeit(&self, gruppe_id: String) -> Result<Option<u32>, JsValue> {
        self.lies(|i| Ok(i.engine.prepare_convergence_cutoff_delay_ms(&gruppe(&gruppe_id)?).map_err(fehler)?.map(|ms| ms.min(u32::MAX as u64) as u32)))
    }

    /// Gepufferte Commits übernehmen, wenn das Zeitfenster vorbei ist.
    /// Ergebnis: `{ nachrichten, geaendert, events, ausstehend }`.
    pub fn fortschreiten(&self, gruppe_id: String) -> Promise {
        self.mit(move |mut i| async move {
            let r = async {
                let gid = gruppe(&gruppe_id)?;
                let mut out = Vec::new();
                let mut ausstehend = None;
                for res in i.engine.advance_convergence(&gid).await.map_err(fehler)? {
                    let v = veroeffentlichen_roh(&mut i, res)?;
                    out.extend(v.events);
                    ausstehend = ausstehend.or(v.ausstehend);
                }
                let mut e = Ergebnis { ergebnis: "fortgeschritten".into(), ..Default::default() };
                sammle(&mut i, &mut e);
                json(&serde_json::json!({ "nachrichten": e.nachrichten, "geaendert": e.geaendert, "events": out, "ausstehend": ausstehend }))
            }
            .await;
            (i, r)
        })
    }

    /// Mitglieder (Identitäten hex).
    pub fn mitglieder(&self, gruppe_id: String) -> Result<Vec<String>, JsValue> {
        self.lies(|i| Ok(i.engine.members(&gruppe(&gruppe_id)?).map_err(fehler)?.iter().map(|m| hex::encode(m.id.as_slice())).collect()))
    }

    /// Alle Gruppen dieses Kontos.
    pub fn gruppen(&self) -> Result<Vec<String>, JsValue> {
        self.lies(|i| Ok(i.engine.live_group_ids().map_err(fehler)?.iter().map(|g| hex::encode(g.as_slice())).collect()))
    }

    pub fn epoche(&self, gruppe_id: String) -> Result<f64, JsValue> {
        self.lies(|i| Ok(i.engine.epoch(&gruppe(&gruppe_id)?).map_err(fehler)?.0 as f64))
    }
}

fn veroeffentlichen_roh(i: &mut Innen, res: SendResult) -> Result<Veroeffentlichen, JsValue> {
    let mut v = Veroeffentlichen { events: vec![], ausstehend: None, einladungen: vec![] };
    match res {
        SendResult::ApplicationMessage { msg, .. } | SendResult::Proposal { msg } => v.events.push(als_event(&msg)?),
        SendResult::GroupEvolution { msg, welcomes, pending } => {
            v.events.push(als_event(&msg)?);
            v.einladungen = welcomes.iter().map(als_event).collect::<Result<_, _>>()?;
            let schluessel = format!("{pending:?}");
            i.ausstehend.insert(schluessel.clone(), pending);
            v.ausstehend = Some(schluessel);
        }
        SendResult::Queued { .. } | SendResult::NoChange { .. } => {}
        anders => return Err(fehler(format!("unerwartet: {anders:?}"))),
    }
    Ok(v)
}

fn veroeffentlichen(i: &mut Innen, res: SendResult) -> Result<JsValue, JsValue> {
    let v = veroeffentlichen_roh(i, res)?;
    json(&v)
}

/// Ereignisse der Engine abholen: Nachrichten und geänderte Gruppen.
fn sammle(i: &mut Innen, e: &mut Ergebnis) {
    for ev in i.engine.drain_events() {
        match ev {
            GroupEvent::MessageReceived { group_id, message_id, sender, payload, .. } => {
                if let Ok(app) = MarmotAppEvent::decode(&payload) {
                    if app.kind == MARMOT_APP_EVENT_KIND_CHAT {
                        e.nachrichten.push(Nachricht {
                            gruppe: hex::encode(group_id.as_slice()),
                            von: hex::encode(sender.as_slice()),
                            text: app.content,
                            zeit: app.created_at,
                            id: hex::encode(message_id.as_slice()),
                        });
                    }
                }
            }
            GroupEvent::GroupStateChanged { group_id, .. } | GroupEvent::GroupJoined { group_id, .. } => {
                let g = hex::encode(group_id.as_slice());
                if !e.geaendert.contains(&g) {
                    e.geaendert.push(g);
                }
            }
            _ => {}
        }
    }
}
