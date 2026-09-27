/** Texte des Agent-Tabs (8.16; vollständig ab 8.16c). */
import type { Texte } from "../i18n.js";

export const agent: Texte = {
  emptySub: { de: "Stell eine Frage. Du zahlst pro Anfrage.", en: "Ask a question. You pay per request." },
  emptyHint: { de: "Modell wählen · Werkzeuge anhängen", en: "Choose a model · attach tools" },
  aiPlaceholder: { de: "Nachricht an den Agenten", en: "Message the agent" },
  send: { de: "Senden", en: "Send" },
  // Stand eines Auftrags (setTypingStatus/showTyping)
  thinking: { de: "denkt nach…", en: "thinking…" },
  connecting: { de: "verbindet…", en: "connecting…" },
  researching: { de: "recherchiert…", en: "researching…" },
  creating: { de: "erstellt…", en: "creating…" },
  copyLast: { de: "Letzte kopieren", en: "Copy last" },
  copyAll: { de: "Alle kopieren", en: "Copy all" },
  bid: { de: "Gebot (sats)", en: "Bid (sats)" },
  tierFree: { de: "Free — kleines Modell", en: "Free — small model" },
  tierClassic: { de: "Classic — ausgewogen", en: "Classic — balanced" },
  tierPro: { de: "Pro — vertrauenswürdige Anbieter", en: "Pro — trusted providers" },
  tierMax: { de: "Max — schnellster gewinnt", en: "Max — fastest wins" },
  tierSwarm: { de: "Swarm — bestes aus mehreren", en: "Swarm — best of several" },
};
