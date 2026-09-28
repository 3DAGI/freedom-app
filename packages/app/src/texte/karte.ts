/** Texte der Abdeckungskarte (seit C.4a); Ebenen und Stufen stehen weiter unter `earn.*`. */
import type { Texte } from "../i18n.js";

export const karte: Texte = {
  "karte.aria": { de: "Abdeckungskarte – Pfeiltasten verschieben, Plus und Minus zoomen, 0 zeigt die ganze Welt, Tab springt zu den Gebieten", en: "Coverage map – arrow keys pan, plus and minus zoom, 0 shows the whole world, Tab jumps to the areas" },
  "karte.ansichtAria": { de: "Ansicht der Abdeckung", en: "Coverage view" },
  "karte.liste": { de: "Liste", en: "List" },
  "karte.ebenenAria": { de: "Ebenen ein- und ausblenden", en: "Show or hide layers" },
  "karte.naeher": { de: "Näher heran", en: "Zoom in" },
  "karte.weiter": { de: "Weiter weg", en: "Zoom out" },
  "karte.welt": { de: "Ganze Welt", en: "Whole world" },
  "karte.bedienung": { de: "Ziehen oder Pfeiltasten verschieben, Mausrad, zwei Finger oder Plus/Minus zoomen. Ein Gebiet antippen (oder Enter) zeigt seine Angaben.", en: "Drag or use the arrow keys to pan; mouse wheel, two fingers or plus/minus to zoom. Tap an area (or press Enter) to see its details." },
  "karte.gebiet": { de: "um {lat}° {ns}, {lon}° {ow}", en: "around {lat}° {ns}, {lon}° {ow}" },
  "karte.nord": { de: "N", en: "N" },
  "karte.sued": { de: "S", en: "S" },
  "karte.ost": { de: "O", en: "E" },
  "karte.west": { de: "W", en: "W" },
  "karte.zelle": { de: "{ebene}: {gebiet} – {stufe}", en: "{ebene}: {gebiet} – {stufe}" },
  "karte.schwelle": { de: "Funk und Bluetooth erscheinen erst ab {k} Einträgen je Gebiet, Provider im Netz ab einem – deren Adresse ist ohnehin öffentlich. Die Schwelle schützt nur die Anzeige: Auf den Relays ist jeder Eintrag einzeln sichtbar.", en: "Radio and Bluetooth only appear from {k} entries per area, online providers from one – their address is public anyway. The threshold only protects the display: on the relays every entry is visible individually." },
  "karte.keineZellen": { de: "Noch kein Gebiet über der Schwelle. Eintragen ist freiwillig – es kann trotzdem Abdeckung geben.", en: "No area above the threshold yet. Adding yourself is voluntary – there may be coverage anyway." },
};
