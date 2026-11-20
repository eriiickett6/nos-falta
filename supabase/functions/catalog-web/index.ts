// Catálogo de varios súpers desde sus fichas públicas de producto (sitemap + JSON-LD de schema.org).
// Solo se leen páginas que su robots.txt permite. Una ficha por segundo y por súper; si el servidor
// responde con 403/429/503 o un reto, paramos ese súper y no insistimos.
// Súpers: Alcampo y Bonpreu i Esclat (misma plataforma), Ahorramas, Gadis y Ametller Origen.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

type Cfg = { base: string, maps: string[], index?: string, re: RegExp, kind: 'ocado' | 'sfcc' | 'gadis', headers?: Record<string, string> };
const S: Record<string, Cfg> = {
  alcampo: { base: 'https://www.compraonline.alcampo.es', kind: 'ocado', re: /\/products\/[^\/<\s]+\/(\d+)$/,
    maps: ['https://www.compraonline.alcampo.es/sitemaps/sitemap-products-part1.xml', 'https://www.compraonline.alcampo.es/sitemaps/sitemap-products-part2.xml'] },
  bonpreu: { base: 'https://www.compraonline.bonpreuesclat.cat', kind: 'ocado', re: /\/products\/[^\/<\s]+\/(\d+)$/,
    maps: ['https://www.compraonline.bonpreuesclat.cat/sitemaps/sitemap-products-part1.xml'] },
  ahorramas: { base: 'https://www.ahorramas.com', kind: 'sfcc', re: /ahorramas\.com\/[^\/<\s]+-(\d+)\.html$/,
    maps: ['https://www.ahorramas.com/sitemap_0-product.xml'] },
  gadis: { base: 'https://www.gadisline.com', kind: 'gadis', re: /gadisline\.com\/([a-z0-9-]+)$/,
    maps: ['https://www.gadisline.com/sitemaps/sitemap_productos.xml'] },
  ametller: { base: 'https://www.ametllerorigen.com', kind: 'sfcc', re: /ametllerorigen\.com\/es\/[^\/<\s]+\/(\d+)\.html$/,
    maps: [], index: 'https://www.ametllerorigen.com/sitemap_index.xml' },
};
// palabras del enlace que delatan que no es comida, bebida, higiene ni limpieza (para no visitar esas fichas)
const SKIP = new Set(('pantalon pantalones camiseta camisetas calcetines calcetin zapatilla zapatillas zapato zapatos sudadera pijama chaqueta abrigo vestido falda bolso mochila maleta ' +
  'juguete juguetes muneca puzzle lego consola playstation nintendo xbox televisor tv smart movil smartphone tablet portatil ordenador monitor impresora auricular auriculares altavoz cable cargador ' +
  'camara reloj bicicleta patinete colchon almohada sabana sabanas edredon funda nordico toalla toallas cortina alfombra lampara mueble silla sillas sofa estanteria sarten sartenes cazo olla ' +
  'plato platos vaso vasos taza tazas copa copas cubiertos cuchillo cuchillos tenedor jarra fiambrera tupper neumatico libro cuaderno boligrafo forro taladro destornillador bombilla ' +
  'lavadora frigorifico microondas aspiradora secador plancha cafetera batidora freidora tostadora horno vitroceramica ventilador calefactor radiador estufa barbacoa maceta manguera ' +
  'samarreta mitjons sabates jaqueta bossa joguina llibre cadira tovallola llencol coixi cassola paella got gots tassa plats ganivet').split(' '));

const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const unent = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<br\s*\/?>/g, ' ');
const num = (s: any) => { if (s == null) return null; const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : null; };

function parseNet(t: string): { q: number | null, u: string | null, n: number } {
  const s = (t || '').toLowerCase();
  const pk = s.match(/(\d{1,2})\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ml|cl)\b/);
  const m = pk ? [pk[0], pk[2], pk[3]] : s.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|grs|gramos|l|lt|litros?|ml|cl)\b/);
  if (!m) return { q: null, u: null, n: 1 };
  const n = pk ? parseInt(pk[1]) : 1;
  let q = parseFloat(String(m[1]).replace(',', '.')); const u = String(m[2]);
  if (/^(g|gr|grs|gramos)$/.test(u)) q /= 1000; else if (u === 'ml') q /= 1000; else if (u === 'cl') q /= 100;
  if (!q) return { q: null, u: null, n: 1 };
  return { q: +(q * n).toFixed(4), u: /^(kg|kilo|g|gr|grs|gramos)/.test(u) ? 'kg' : 'l', n };
}
const fmt = (q: number, u: string) => (u === 'kg' && q < 1 ? Math.round(q * 1000) + ' g' : u === 'l' && q < 1 ? Math.round(q * 1000) + ' ml' : String(+q.toFixed(3)).replace('.', ',') + ' ' + u);

function ldAll(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, ' ')); (Array.isArray(j) ? j : [j]).forEach(x => out.push(x)); } catch { /* sigue */ }
  }
  return out;
}
// lee un objeto JSON que empieza en "start" (cuenta llaves respetando cadenas)
function objAt(s: string, start: number): any {
  let d = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function parse(store: string, cfg: Cfg, html: string, url: string, id: string) {
  const lds = ldAll(html);
  const ld = lds.find(x => x && x['@type'] === 'Product');
  if (!ld?.name) return null;
  const off = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers || {};
  let price = num(off.price ?? off.lowPrice);
  let name = unent(String(ld.name)).replace(/\s+/g, ' ').trim();
  let brand: string | null = typeof ld.brand === 'string' ? ld.brand : ld.brand?.name || null;
  let img: string | null = Array.isArray(ld.image) ? ld.image[0] : (typeof ld.image === 'string' ? ld.image : null);
  if (img && img.startsWith('/')) img = cfg.base + img;
  let size: string | null = ld.size || null;
  let path: string | null = null, unit_price: number | null = null, unit: string | null = null, old: number | null = null;

  if (cfg.kind === 'ocado') {
    const k = html.indexOf('window.__QUERY_INITIAL_STATE__=');
    if (k >= 0) {
      const st = objAt(html, html.indexOf('{', k));
      const q = (st?.queries || []).map((x: any) => x?.state?.data?.product).find((p: any) => p && String(p.retailerProductId) === id);
      if (q) {
        if (q.price?.amount) price = num(q.price.amount);
        const up = q.unitPrice; const uu = String(up?.unit || '');
        if (up?.price?.amount && /(kg|kilo|litre|litro)/.test(uu)) { unit_price = num(up.price.amount); unit = /litre|litro/.test(uu) ? 'l' : 'kg'; }
        const op = q.originalPrice?.amount ?? q.previousPrice?.amount ?? q.wasPrice?.amount;
        if (op) old = num(op);
        if (Array.isArray(q.categoryPath)) path = q.categoryPath.join(' > ');
        if (q.packSizeDescription) size = q.packSizeDescription;
        if (q.brand) brand = q.brand;
      }
    }
    // el nombre lleva la marca delante en mayúsculas ("GALLO Farina..."): la quitamos para leerlo mejor
    if (brand && name.toUpperCase().startsWith(brand.toUpperCase() + ' ')) name = name.slice(brand.length + 1);
  } else if (cfg.kind === 'sfcc') {
    const bc = lds.find(x => x && x['@type'] === 'BreadcrumbList');
    if (bc?.itemListElement) path = bc.itemListElement.map((e: any) => e?.item?.name || e?.name).filter(Boolean).join(' > ');
    if (!path) { const b = [...html.matchAll(/class="breadcrumb-item[^"]*"[\s\S]{0,300}?<a[^>]*>\s*([^<]{2,60}?)\s*<\/a>/g)].map(m => unent(m[1]).trim()); if (b.length) path = b.join(' > '); }
    const lp = html.match(/class="strike-through[^"]*"[\s\S]{0,300}?content="([\d.]+)"/);
    if (lp) old = num(lp[1]);
    const up = html.match(/([\d]+[.,]\d{2})\s*(?:&euro;|€)\s*\/\s*(kg|kilo|l|litro)\b/i);
    if (up) { unit_price = num(up[1]); unit = /^l/i.test(up[2]) ? 'l' : 'kg'; }
  } else if (cfg.kind === 'gadis') {
    const pk = html.indexOf('"product":{"id"');
    const p = pk >= 0 ? objAt(html, html.indexOf('{', pk + 9)) : null;
    if (p) {
      if (p.price != null) price = num(p.price);
      if (p.price_kilo_litre != null) { unit_price = num(p.price_kilo_litre); unit = /litro/i.test(p.price_kilo_litre_suffix || '') ? 'l' : 'kg'; }
      const op = p.price_before ?? p.previous_price ?? p.old_price ?? p.crossed_price;
      if (op) old = num(op);
    }
    const bc = lds.find(x => x && x['@type'] === 'BreadcrumbList');
    if (bc?.itemListElement) path = bc.itemListElement.map((e: any) => e?.item?.name || e?.name).filter(Boolean).join(' > ');
    if (!path) {
      // la categoría va justo antes del producto: "/navidad/resto-articulos-navidad/...","level"
      const near = pk >= 0 ? html.slice(Math.max(0, pk - 4000), pk) : '';
      const all = [...near.matchAll(/"(\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)","level"/g)];
      const cu = all.length ? all[all.length - 1] : null;
      if (cu) path = [...new Set(cu[1].split('/').filter(Boolean))].map(s => s.replace(/-/g, ' ')).join(' > ');
    }
  }
  const net = parseNet((size || '') + ' ' + name);
  let net_qty = net.q, net_unit = net.u;
  if (price && unit_price && unit && (!net_qty || net_unit !== unit)) { net_qty = +(price / unit_price).toFixed(3); net_unit = unit; }
  const loose = /granel|al peso|a pes\b|\bpeso variable|\bkilo$/i.test(name + ' ' + (size || '')) && unit_price != null && price != null && Math.abs(price - unit_price) < 0.01;
  return {
    store, ext_id: id, url, name, brand: brand ? unent(String(brand)).trim() : null, image_url: img,
    size_label: net_qty && net_unit ? (net.n > 1 ? net.n + ' x ' + fmt(net_qty / net.n, net_unit) : fmt(net_qty, net_unit)) : (size || null),
    net_qty, net_unit, pack_n: net.n > 1 ? net.n : null,
    price, unit_price, unit, loose,
    old_price: old && price && old > price ? old : null, promo_until: null,
    store_cat: path ? path.toLowerCase().replace(/\s*>\s*/g, '*') .slice(0, 300) : null, store_cat_path: path,
    active: price != null,
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfgRow } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfgRow || req.headers.get('x-import-token') !== cfgRow.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const store = String(body.store || ''); const cfg = S[store];
  if (!cfg) return J({ error: 'store' });
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xml,application/json,text/plain', 'Accept-Language': 'es-ES,es;q=0.9', ...(cfg.headers || {}), ...(body.headers || {}) } });
  const idOf = (u: string) => (u.match(cfg.re) || [])[1];

  if (body.action === 'test') {
    const r = await get(body.url); const html = await r.text();
    const dbg: any = {};
    if (body.grep) { const rx = new RegExp(body.grep, 'g'); let m; const a: string[] = []; while ((m = rx.exec(html)) && a.length < 5) a.push(html.slice(Math.max(0, m.index - 200), m.index + 400)); dbg.grep = a; }
    return J({ status: r.status, len: html.length, item: parse(store, cfg, html, body.url, idOf(body.url) || ''), ...dbg });
  }

  if (body.action === 'seed') {
    let maps = cfg.maps.slice();
    if (cfg.index) { const r = await get(cfg.index); const x = await r.text(); maps = [...x.matchAll(/<loc>\s*([^<\s]+product[^<\s]*\.xml)\s*<\/loc>/g)].map(m => m[1]); }
    const seen = new Set<string>(); const rows: any[] = []; let skipped = 0;
    for (const mu of maps) {
      const r = await get(mu); if (!r.ok) continue;
      const xml = await r.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const loc = unent(m[1]); const id = idOf(loc); if (!id || seen.has(id)) continue;
        seen.add(id);
        let slug = loc.split('/').filter(Boolean).slice(-2).join('-').toLowerCase();
        try { slug = decodeURIComponent(slug); } catch { /* */ }
        slug = slug.normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (slug.split(/[^a-z0-9]+/).some(w => SKIP.has(w))) { skipped++; continue; }
        rows.push({ store, ext_id: id, url: loc, status: 'new' });
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 1000), { onConflict: 'store,ext_id', ignoreDuplicates: !body.reset });
      if (error) return J({ error: error.message });
    }
    return J({ ok: true, maps: maps.length, products: rows.length, skipped });
  }

  if (body.action === 'crawl') {
    const t0 = Date.now(); const budget = body.ms ?? 110000; const pause = body.pause ?? 900;
    const { data: q } = await sb.from('c_queue').select('*').eq('store', store).eq('status', 'new').limit(body.n ?? 60);
    let saved = 0, bad = 0, blocked = false, skipped = 0;
    for (const job of q || []) {
      if (Date.now() - t0 > budget) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404 || r.status === 410) status = 'gone';
        else if (r.status !== 200) { status = 'error'; err = 'HTTP ' + r.status; if ([202, 403, 405, 429, 503].includes(r.status)) blocked = true; }
        else {
          const html = await r.text();
          if (/challenge|captcha/i.test(html.slice(0, 3000)) && !/application\/ld\+json/.test(html)) { status = 'error'; err = 'reto'; blocked = true; }
          else {
            const it = parse(store, cfg, html, job.url, job.ext_id);
            if (!it) { status = 'error'; err = 'sin datos'; }
            else {
              const { data: rows, error } = await sb.from('c_items').upsert({ ...it, updated_at: new Date().toISOString() }, { onConflict: 'store,ext_id' }).select('id,price,unit_price,excluded');
              if (error) { status = 'error'; err = error.message.slice(0, 200); bad++; }
              else {
                const x: any = rows![0];
                if (x?.excluded) skipped++; else saved++;
                if (x?.price != null && !x.excluded) await sb.from('c_price_hist').upsert({ item_id: x.id, price: x.price, unit_price: x.unit_price }, { onConflict: 'item_id,seen_on' });
              }
            }
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', store).eq('ext_id', job.ext_id);
      if (blocked) break; // si el servidor nos frena, paramos y no insistimos
      await sleep(pause);
    }
    return J({ ok: true, store, picked: (q || []).length, saved, excluded: skipped, errors: bad, blocked, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
