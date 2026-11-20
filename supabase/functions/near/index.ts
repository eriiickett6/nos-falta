// Súpers cerca de un código postal, con datos abiertos de OpenStreetMap (ODbL).
// 1) Código postal -> coordenadas con la tabla pc_geo (GeoNames, CC BY 4.0).  2) Overpass: supermercados en 10 km.
// Guardamos el resultado 30 días en near_cache para no repetir consultas (normas de uso de OSM).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';

const UA = 'NosFalta/1.0 (proyecto escolar FP; lista de la compra)';
const R = 10000; // metros
const OP = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const BRANDS: [string, RegExp][] = [
  ['mercadona', /mercadona/i], ['lidl', /\blidl\b/i], ['aldi', /\baldi\b/i], ['bonarea', /bon\s*[àa]rea/i],
  ['condis', /condis/i], ['carrefour', /carrefour/i], ['dia', /^(dia|dia\s*%|dia market|dia maxi|la plaza de dia|cl[aà]rel)\b/i],
  ['alcampo', /alcampo|simply|sabeco/i], ['bonpreu', /bonpreu|esclat/i],
  ['ahorramas', /ahorramas/i], ['gadis', /\bgadis\b/i], ['ametller', /ametller/i], ['froiz', /froiz/i],
];
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
function km(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
function storeOf(t: any): string | null {
  const s = [t.brand, t.name, t.operator].filter(Boolean).join(' | ');
  for (const [id, re] of BRANDS) if (re.test(s)) return id;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: H });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const u = new URL(req.url);
  let cp = u.searchParams.get('cp') || '';
  let body: any = {};
  if (req.method === 'POST') { body = await req.json().catch(() => ({})); cp = body.cp || cp; }
  // carga única de los códigos postales de España (GeoNames, CC BY 4.0); solo con el token interno
  if (body.action === 'loadpc' || body.action === 'testop') {
    const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
    if (!cfg || req.headers.get('x-import-token') !== cfg.value) return J({ error: 'forbidden' }, 403);
    if (body.action === 'testop') {
      const res: any[] = [];
      for (const ep of (body.ep ? [body.ep] : OP)) for (const ua of [UA, 'Mozilla/5.0 (compatible; NosFalta/1.0)']) {
        try {
          const r = await fetch(ep, { signal: AbortSignal.timeout(12000), method: 'POST', headers: { 'User-Agent': ua, 'Accept': 'application/json,*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent('[out:json];node(41.38,2.15,41.39,2.16)["shop"="supermarket"];out 3;') });
          res.push({ ep, ua: ua.slice(0, 12), status: r.status, body: (await r.text()).slice(0, 120) });
        } catch (e) { res.push({ ep, err: String(e).slice(0, 120) }); }
      }
      return J(res);
    }
    const z = await fetch('https://download.geonames.org/export/zip/ES.zip', { headers: { 'User-Agent': UA } });
    if (!z.ok) return J({ error: 'geonames_' + z.status }, 502);
    const files = unzipSync(new Uint8Array(await z.arrayBuffer()));
    const txt = strFromU8(files['ES.txt']);
    const seen = new Map<string, any>();
    for (const line of txt.split('\n')) {
      const c = line.split('\t'); if (c.length < 11 || !/^\d{5}$/.test(c[1])) continue;
      const k = c[1]; const lat = +c[9], lon = +c[10];
      const o = seen.get(k);
      if (!o) seen.set(k, { postcode: k, place: [c[2], c[5] || c[3]].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '), lat, lon, n: 1 });
      else { o.lat = (o.lat * o.n + lat) / (o.n + 1); o.lon = (o.lon * o.n + lon) / (o.n + 1); o.n++; }
    }
    const rows = [...seen.values()].map(({ n, ...r }) => r);
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('pc_geo').upsert(rows.slice(i, i + 1000), { onConflict: 'postcode' });
      if (error) return J({ error: error.message }, 500);
    }
    return J({ ok: true, postcodes: rows.length });
  }
  cp = String(cp).trim();
  if (!/^\d{5}$/.test(cp)) return J({ error: 'cp_no_valido' }, 400);

  const { data: hit } = await sb.from('near_cache').select('*').eq('postcode', cp).maybeSingle();
  if (hit && Date.now() - new Date(hit.updated_at).getTime() < 30 * 864e5 && hit.lat) return J(out(hit));

  // 1) código postal -> punto (tabla de GeoNames)
  const { data: pc } = await sb.from('pc_geo').select('*').eq('postcode', cp).maybeSingle();
  if (!pc) return J({ error: 'cp_no_encontrado' }, 404);
  const lat = +pc.lat, lon = +pc.lon, place = pc.place;

  // 2) supermercados alrededor
  const q = `[out:json][timeout:25];nwr["shop"~"^(supermarket|convenience|department_store)$"](around:${R},${lat},${lon});out center tags 1500;`;
  let el: any[] = [];
  for (const ep of OP) {
    try {
      const r = await fetch(ep, { signal: AbortSignal.timeout(25000), method: 'POST', headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (r.ok) { el = (await r.json()).elements || []; break; }
    } catch { /* probamos el siguiente */ }
  }
  if (!el.length) return J({ error: 'mapa_no_disponible', cp, place, lat, lon }, 503);
  const shops: any[] = [];
  for (const e of el) {
    const t = e.tags || {}; const id = storeOf(t); if (!id) continue;
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la == null) continue;
    const addr = [[t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', '), t['addr:city']].filter(Boolean).join(' · ');
    shops.push({ store: id, name: t.name || t.brand || id, lat: +la.toFixed(6), lon: +lo.toFixed(6), addr: addr || null, hours: t.opening_hours || null, km: +km(lat, lon, la, lo).toFixed(2) });
  }
  shops.sort((x, y) => x.km - y.km);
  // como mucho 12 tiendas por cadena
  const per: Record<string, number> = {}; const kept = shops.filter(s => (per[s.store] = (per[s.store] || 0) + 1) <= 12);
  const row = { postcode: cp, lat, lon, place, shops: kept, updated_at: new Date().toISOString() };
  await sb.from('near_cache').upsert(row, { onConflict: 'postcode' });
  return J(out(row));
});

function out(r: any) {
  const by: Record<string, { id: string, n: number, km: number }> = {};
  for (const s of r.shops || []) { const b = by[s.store] ||= { id: s.store, n: 0, km: s.km }; b.n++; b.km = Math.min(b.km, s.km); }
  return { cp: r.postcode, place: r.place, lat: r.lat, lon: r.lon, shops: r.shops, stores: Object.values(by).sort((a, b) => a.km - b.km) };
}
