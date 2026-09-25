//! Spike 2.2a (a): OpenMLS (Fork aus MDK) im Browser – zwei Mitglieder, Nachricht, Entfernen.
use openmls::prelude::{tls_codec::*, *};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use wasm_bindgen::prelude::*;

const CS: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

fn mitglied(name: &str, p: &OpenMlsRustCrypto) -> (CredentialWithKey, SignatureKeyPair) {
    let cred = BasicCredential::new(name.as_bytes().to_vec());
    let sig = SignatureKeyPair::new(CS.signature_algorithm()).unwrap();
    sig.store(p.storage()).unwrap();
    (CredentialWithKey { credential: cred.into(), signature_key: sig.public().into() }, sig)
}

#[wasm_bindgen]
pub fn spike() -> String {
    let pa = OpenMlsRustCrypto::default();
    let pb = OpenMlsRustCrypto::default();
    let (ca, sa) = mitglied("alice", &pa);
    let (cb, sb) = mitglied("bob", &pb);
    let kp_b = KeyPackage::builder().build(CS, &pb, &sb, cb).unwrap();
    let cfg = MlsGroupCreateConfig::builder().ciphersuite(CS).use_ratchet_tree_extension(true).build();
    let mut ga = MlsGroup::new(&pa, &sa, &cfg, ca).unwrap();
    let (_, welcome, _) = ga.add_members(&pa, &sa, &[kp_b.key_package().clone()]).unwrap();
    ga.merge_pending_commit(&pa).unwrap();
    let welcome_bytes = welcome.tls_serialize_detached().unwrap();
    let w = MlsMessageIn::tls_deserialize_exact(&welcome_bytes).unwrap();
    let MlsMessageBodyIn::Welcome(w) = w.extract() else { panic!() };
    let mut gb = StagedWelcome::new_from_welcome(&pb, &MlsGroupJoinConfig::default(), w, None).unwrap().into_group(&pb).unwrap();
    let m1 = ga.create_message(&pa, &sa, b"Hallo Bob").unwrap().tls_serialize_detached().unwrap();
    let lese = |gb: &mut MlsGroup, bytes: &[u8]| -> Result<String, String> {
        let m = MlsMessageIn::tls_deserialize_exact(bytes).map_err(|e| e.to_string())?;
        let p = m.try_into_protocol_message().map_err(|e| e.to_string())?;
        let pm = gb.process_message(&pb, p).map_err(|e| e.to_string())?;
        match pm.into_content() {
            ProcessedMessageContent::ApplicationMessage(a) => Ok(String::from_utf8_lossy(&a.into_bytes()).into()),
            _ => Ok("(kein Text)".into()),
        }
    };
    let r1 = lese(&mut gb, &m1);
    let bob_index = gb.own_leaf_index();
    let (commit, _, _) = ga.remove_members(&pa, &sa, &[bob_index]).unwrap();
    ga.merge_pending_commit(&pa).unwrap();
    let _ = lese(&mut gb, &commit.tls_serialize_detached().unwrap());
    let m2 = ga.create_message(&pa, &sa, b"Nach dem Entfernen").unwrap().tls_serialize_detached().unwrap();
    let r2 = lese(&mut gb, &m2);
    format!("{{\"nachricht_1\":{:?},\"nach_entfernen\":{:?},\"bytes\":{}}}", r1, r2, m1.len())
}
