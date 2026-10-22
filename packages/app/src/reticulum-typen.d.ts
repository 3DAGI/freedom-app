// LXMF hat keine Typen für Unterpfade (kein `typesVersions` wie `@reticulum/core`). Die Nachricht allein laden, nicht den
// ganzen Router aus dem Sammelmodul – dieselben Typen, die das Paket mitbringt (B-32a).
declare module "@reticulum/lxmf/src/message.js" {
  export { Message } from "@reticulum/lxmf/types/src/message.js";
}
// Ebenso der Router allein (B-32b2) – nicht der Sammelpunkt mit Propagation-Knoten und Papier-Nachrichten.
declare module "@reticulum/lxmf/src/router.js" {
  export { LXMRouter } from "@reticulum/lxmf/types/src/router.js";
}
