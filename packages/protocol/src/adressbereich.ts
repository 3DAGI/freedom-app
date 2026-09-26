/**
 * Nicht-oeffentliche Adressbereiche (Schritt 8.7, vorher in
 * node/src/url-guard.ts) – fuer den SSRF-Waechter des Knotens und die lokalen
 * Werkzeuge der App.
 */

/** Prüft, ob eine IPv4-Adresse in einem nicht-öffentlichen Bereich liegt. */
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 10) return true;                        // 10.0.0.0/8
  if (a === 127) return true;                       // Loopback
  if (a === 0) return true;                         // "dieses Netz"
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a === 169 && b === 254) return true;          // Link-local INKL. Cloud-Metadaten
  if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT
  if (a >= 224) return true;                        // Multicast + reserviert
  return false;
}

/**
 * IPv6 in acht 16-Bit-Gruppen, auch mit „::“ und eingebetteter IPv4 am Ende;
 * null bei ungueltiger Form.
 */
function ipv6Gruppen(s: string): number[] | null {
  let t = s;
  const v4 = t.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    t = t.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const teile = t.split("::");
  if (teile.length > 2) return null;
  const links = teile[0] ? teile[0].split(":") : [];
  const rechts = teile.length === 2 && teile[1] ? teile[1].split(":") : [];
  const fehlt = 8 - links.length - rechts.length;
  if (teile.length === 1 ? fehlt !== 0 : fehlt < 1) return null;
  const alle = [...links, ...Array(teile.length === 2 ? fehlt : 0).fill("0"), ...rechts];
  if (alle.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return alle.map((g) => parseInt(g, 16));
}

/**
 * Dasselbe für IPv6, inklusive der eingebetteten IPv4-Formen – auch in
 * Hex-Schreibweise: `new URL("http://[::ffff:127.0.0.1]/")` liefert den Host
 * `[::ffff:7f00:1]`, und bis 8.7 galt der als oeffentlich (SSRF-Luecke).
 */
export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const g = ipv6Gruppen(s);
  if (!g) return true; // unklar = nicht erlauben
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const nullBis = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (nullBis(8)) return true;                                   // ::
  if (nullBis(7) && g[7] === 1) return true;                     // ::1
  if (nullBis(5) && g[5] === 0xffff) return isPrivateIPv4(v4(g[6], g[7]));  // ::ffff:a.b.c.d (mapped)
  if (nullBis(6)) return isPrivateIPv4(v4(g[6], g[7]));           // ::a.b.c.d (compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(v4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateIPv4(v4(g[1], g[2]));      // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true;                   // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                   // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;                   // ff00::/8 Multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}
