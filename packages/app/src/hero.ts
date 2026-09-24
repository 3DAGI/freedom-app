/**
 * Landing-Hero: WebGL/canvas-Hintergrund mit Cursor-Interaktion (v0.2).
 *
 * Inspiriert vom kaolti-Video (H3-Video als Textur + Scrubbing). Da das
 * H3-Video-Rendering noch laeuft, ist das hier eine performante Canvas-Version:
 * ein Feld aus "circuit"-Partikeln, die auf die Maus reagieren (anziehen/
 * abstossen) — fuellt den Landing-Hintergrund lebendig, ohne externe Assets.
 *
 * Wenn ein H3-Video fertig ist, kann man es als <video>-Textur scrubben.
 */

export function startHero(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const parent = canvas.parentElement as HTMLElement;
  let w = (canvas.width = parent.clientWidth || window.innerWidth);
  let h = (canvas.height = parent.clientHeight || window.innerHeight);
  const mouse = { x: w / 2, y: h / 2, active: false };

  const onResize = () => {
    w = canvas.width = parent.clientWidth || window.innerWidth;
    h = canvas.height = parent.clientHeight || window.innerHeight;
  };
  window.addEventListener("resize", onResize);

  canvas.parentElement?.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.active = true;
  });
  canvas.parentElement?.addEventListener("pointerleave", () => (mouse.active = false));

  // Partikel-Gitter (circuit-Punkte) — mehr + sichtbarer
  const N = Math.max(120, Math.floor((w * h) / 9000));
  const pts = Array.from({ length: N }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    base: 0.5 + Math.random() * 0.5,
  }));

  const accent = { r: 123, g: 200, b: 10 }; // #7BC80A

  const frame = () => {
    if (!document.body.contains(canvas)) return;
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
    for (const p of pts) {
      if (mouse.active) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 1;
        if (d < 200) {
          // anziehen (sanft), scrubbing-feel
          const f = (1 - d / 200) * 0.6;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.x += p.vx;
      p.y += p.vy;
      // raender weich
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      const speed = Math.min(1, Math.hypot(p.vx, p.vy) / 4);
      const alpha = Math.min(1, p.base * (0.7 + speed * 0.5));
      ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${alpha})`;
      const sz = 2 + speed * 2.5;
      ctx.fillRect(p.x, p.y, sz, sz);
    }
    // verbindungslinien naher punkte (circuit-feel)
    ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},0.22)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < 3600) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
