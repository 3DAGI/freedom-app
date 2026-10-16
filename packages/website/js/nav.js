// Menü-Knopf der Navigation am Handy (C-48): klappt die Links auf und zu. Ohne Skript bleibt die
// Navigation sichtbar (die Klasse „mit-skript“ setzt erst dieses Skript) – nichts ist dann versteckt.
(function () {
  const kopf = document.querySelector(".topnav");
  const knopf = document.getElementById("nav-toggle");
  if (!kopf || !knopf) return;
  kopf.classList.add("mit-skript");
  const setze = (auf) => {
    kopf.classList.toggle("offen", auf);
    knopf.setAttribute("aria-expanded", String(auf));
  };
  knopf.addEventListener("click", () => setze(!kopf.classList.contains("offen")));
  kopf.querySelectorAll("#site-nav a").forEach((a) => a.addEventListener("click", () => setze(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && kopf.classList.contains("offen")) { setze(false); knopf.focus(); }
  });
})();
