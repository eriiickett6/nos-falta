// Catálogo de Lidl España (www.lidl.es): solo productos de tienda (fichas p11…), no el bazar online.
// robots.txt permite las fichas /p/; el sitemap de productos las lista todas.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BASE = 'https://www.lidl.es';
const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// datos de Nuxt: un array plano donde los objetos apuntan a otras posiciones
function nuxt(html: string): any[] | null {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function resolver(arr: any[]) {
  const memo = new Map<number, any>();
  const val = (i: number, d = 0): any => {
    if (typeof i !== 'number' || i < 0 || i >= arr.length) return undefined;
    if (memo.has(i)) return memo.get(i);
    if (d > 40) return null;
    const x = arr[i];
    let out: any = x;
    if (Array.isArray(x)) {
      if (typeof x[0] === 'string' && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef'].includes(x[0])) out = x.length > 1 ? val(x[1], d + 1) : null;
      else if (x[0] === 'Set') out = x.slice(1).map(j => val(j, d + 1));
      else if (x[0] === 'Map') { out = {}; for (let k = 1; k + 1 < x.length; k += 2) out[String(val(x[k], d + 1))] = val(x[k + 1], d + 1); }
      else if (x[0] === 'Date') out = x[1];
      else { out = []; memo.set(i, out); for (const j of x) out.push(val(j, d + 1)); return out; }
    } else if (x && typeof x === 'object') {
      out = {}; memo.set(i, out);
      for (const k of Object.keys(x)) out[k] = val(x[k], d + 1);
      return out;
    }
    memo.set(i, out);
    return out;
  };
  return val;
}
function ldProduct(html: string): any {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]); if (j['@type'] === 'Product') return j; } catch { /* */ }
  }
  return null;
}

const num = (s: any) => { const x = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : null; };
// Promos de varias unidades (2x1, 3x2, 2ª unidad al 50%, 3 por 5 €...). Solo cuenta si el súper lo pone escrito en la zona de la promo.
function promoOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).replace(/<[^>]+>/g, ' ').replace(/&ordf;/g, 'ª').replace(/&ordm;/g, 'º').replace(/&euro;/g, '€').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  let m = t.match(/(?:^|[^\w.,])([2-5])\s*[xX×]\s*([1-4])(?![\w.,]|\s*(?:cl|ml|gr?|kg|l|uds?|unidades|latas|botellas|bricks)\b)/);
  if (m && +m[1] > +m[2]) return m[1] + 'x' + m[2];
  m = t.match(/ll[eé]va(?:te)?\s*([2-5])\s*(?:y\s*)?paga\s*([1-4])/i);
  if (m && +m[1] > +m[2]) return m[1] + 'x' + m[2];
  m = t.match(/(?:([23])\s*[ªaº]\.?|segunda|tercera)\s*(?:ud\.?|unid\.?|unidad|unitat)\s*(gratis|(?:al|a|con\s+un|con|-)?\s*-?\s*(\d{1,3})\s*%)/i);
  if (m) { const k = m[1] || (/tercera/i.test(m[0]) ? '3' : '2'); if (/gratis/i.test(m[2])) return k + 'ª unidad gratis'; const v = +m[3]; if (v > 0 && v <= 100) return k + 'ª unidad al ' + v + '%'; }
  m = t.match(/-?\s*(\d{1,3})\s*%\s*(?:dto\.?|descuento)?\s*(?:en\s+)?(?:la\s+)?([23])\s*[ªaº]\s*(?:ud|unid|unidad|unitat)/i);
  if (m && +m[1] > 0 && +m[1] <= 100) return m[2] + 'ª unidad al ' + m[1] + '%';
  m = t.match(/\b([2-6])\s*(?:uds?\.?|unidades)?\s*por\s*(\d+[.,]\d{2})\s*€/i);
  if (m) return m[1] + ' por ' + m[2].replace('.', ',') + ' €';
  return null;
}
export function parseSize(t: string | null): { q: number | null, u: string | null, n: number | null } {
  if (!t) return { q: null, u: null, n: null };
  const s = t.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  const conv = (q: number, u: string): [number, string] =>
    u === 'kg' ? [q, 'kg'] : (u === 'g' || u === 'gr') ? [q / 1000, 'kg'] : (u === 'l' || u === 'litros' || u === 'litro') ? [q, 'l'] : u === 'ml' ? [q / 1000, 'l'] : u === 'cl' ? [q / 100, 'l'] : [q, u];
  let m = s.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|litros?|l|ml|cl)\b/);
  if (m) { const [q, u] = conv(+m[2], m[3]); return { q: +(q * +m[1]).toFixed(4), u, n: +m[1] }; }
  m = s.match(/(\d+(?:\.\d+)?)\s*(kg|gr|g|litros?|l|ml|cl)\b/);
  if (m) { const [q, u] = conv(+m[1], m[2]); return { q: +q.toFixed(4), u, n: 1 }; }
  m = s.match(/(\d+)\s*(?:u|ud|uds|unidad(?:es)?|piezas?)\b/);
  if (m) return { q: +m[1], u: 'ud', n: +m[1] };
  return { q: null, u: null, n: null };
}
const fmt = (q: number, u: string) => (u === 'kg' && q < 1 ? Math.round(q * 1000) + ' g' : u === 'l' && q < 1 ? Math.round(q * 1000) + ' ml' : String(+q.toFixed(3)).replace('.', ',') + ' ' + u);

function parse(html: string, url: string) {
  const arr = nuxt(html); if (!arr) return null;
  const val = resolver(arr);
  let p: any = null;
  for (let i = 0; i < Math.min(arr.length, 60) && !p; i++) {
    const x = arr[i];
    if (x && typeof x === 'object' && !Array.isArray(x) && 'erpNumber' in x && 'keyfacts' in x && 'price' in x) p = val(i);
  }
  if (!p) return null;
  const ld = ldProduct(html);
  const kf = p.keyfacts || {};
  // el bloque de precio completo (con oldPrice/endDate) es el que tiene más campos; el de Lidl Plus es más corto
  const cands: any[] = [];
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x && typeof x === 'object' && !Array.isArray(x) && 'price' in x && 'packaging' in x && 'basePrice' in x) {
      const o = val(i); if (typeof o?.price === 'number') cands.push({ o, path: String(i), n: Object.keys(x).length });
    }
  }
  cands.sort((a, b) => b.n - a.n);
  const pr: any = cands[0]?.o || {};
  if (pr.price == null) { const og = html.match(/og:description" content="[^"]*?([\d]+[.,]\d{2})\s*€/); if (og) pr.price = num(og[1]); }
  const name = String(kf.fullTitle || kf.title || ld?.name || '').trim();
  // "-50% 2a ud.": Lidl pone en price el precio de la 2ª unidad; el precio normal es el tachado
  const multi = promoOf([pr.discount?.discountText, ...((p.ribbons || []).map((r: any) => r?.text))].filter(Boolean).join(' '));
  const del = num(pr.oldPrice ?? pr.discount?.deletedPrice);
  const price = multi && del ? del : num(pr.price);
  const old = multi ? null : del;
  const pack = String(pr.packaging?.text || '').trim();
  const bp = String(pr.basePrice?.text || '').trim();               // p. ej. "1 kg = 3,59 €" o "precio por kg"
  const mb = bp.toLowerCase().replace(/(\d),(\d)/g, '$1.$2').match(/(?:1\s*)?(kg|l|litro)\s*=\s*([\d.]+)/);
  const unit = mb ? (mb[1] === 'kg' ? 'kg' : 'l') : null;
  let unitAmt = mb ? +mb[2] : null;
  if (multi && unitAmt && num(pr.price) && price) unitAmt = +(unitAmt * price / num(pr.price)!).toFixed(2);
  const loose = /granel|al peso|precio por kg|\/kg|por kilo/i.test(name + ' ' + pack + ' ' + bp) && !/malla|bolsa|bandeja|\d+\s*g\b/i.test(pack);
  const sz = parseSize(pack || name);
  let net_qty = sz.q, net_unit = sz.u;
  if (!loose && price && unitAmt && unit && (!net_qty || net_unit !== unit)) { net_qty = +(price / unitAmt).toFixed(3); net_unit = unit; }
  let unit_price: number | null = unitAmt, u2: string | null = unit;
  if (!unit_price && price && net_qty && (net_unit === 'kg' || net_unit === 'l')) { unit_price = +(price / net_qty).toFixed(2); u2 = net_unit; }
  if (loose && price && !unit_price) { unit_price = price; u2 = 'kg'; }
  const wPath = String(kf.wonCategoryPrimaryPath || '');
  const wName = String(kf.wonCategoryPrimary || '');
  const names = wName.split('/').slice(2);                            // quita "Mundos de necesidad/Comida y…"
  const ids = wPath.split('/').filter(Boolean).slice(1);
  const img = (ld?.image || [])[0] || null;
  const end = pr.endDate ? String(pr.endDate).slice(0, 10) : null;
  return {
    store: 'lidl', ext_id: String(p.erpNumber), url,
    name, brand: (ld?.brand?.name) || null, image_url: img,
    size_label: loose ? (pack ? pack.replace(/(\d)(kg|g|l|ml)\b/i, '$1 $2') : 'a granel') : (pack ? pack.replace(/(\d)(kg|g|l|ml)\b/i, '$1 $2') : (net_qty && net_unit ? fmt(net_qty, net_unit) : null)),
    net_qty: loose ? null : net_qty, net_unit: loose ? null : net_unit, pack_n: sz.n && sz.n > 1 ? sz.n : null,
    price, unit_price: u2 ? unit_price : null, unit: u2, loose,
    old_price: old && price && old > price ? old : null, promo_until: (old && price && old > price) || multi ? end : null, promo_text: multi,
    store_cat: ids.length ? ids.join('*') : null, store_cat_path: names.length ? names.join(' > ') : (p.category || null),
    excluded: /electr|informát|ropa|calzado|herramient|bricolaje|juguete|deporte|muebl/i.test(wName),
    active: price != null,
    _raw: { pack, bp, cat: wName, analytics: kf.analyticsCategory, prPaths: cands.map(c => c.path + ':' + c.o.price) },
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });

  if (body.action === 'dump') {
    const r = await get(body.url); const html = await r.text();
    const ld = ldProduct(html);
    const arr = nuxt(html);
    const out: any = { status: r.status, ld: ld ? { name: ld.name, brand: ld.brand, gtin: ld.gtin13, img: (ld.image || [])[0], offers: ld.offers } : null, len: arr?.length };
    if (arr) {
      const val = resolver(arr);
      const hits: any[] = [];
      for (let i = 0; i < arr.length && hits.length < 12; i++) {
        const x = arr[i];
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          const ks = Object.keys(x);
          if (ks.some(k => (body.keys || ['basePrice', 'packaging', 'category', 'keyfacts', 'fullTitle', 'erpNumber']).includes(k))) {
            const o = val(i);
            hits.push({ i, keys: ks, o: JSON.stringify(o).slice(0, body.cut || 900) });
          }
        }
      }
      out.hits = hits;
    }
    return J(out);
  }
  if (body.action === 'test') {
    const out: any[] = [];
    for (const u of body.urls || []) { const r = await get(u); out.push({ u, status: r.status, item: parse(await r.text(), u) }); await sleep(800); }
    return J(out);
  }

  if (body.action === 'seed') {
    const r = await get(BASE + '/p/export/ES/es/product_sitemap.xml.gz');
    if (!r.ok) return J({ error: 'HTTP ' + r.status });
    let xml: string;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) xml = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    else xml = new TextDecoder().decode(buf);
    const rows: any[] = []; const seen = new Set<string>();
    for (const m of xml.matchAll(/<loc>\s*(https:\/\/www\.lidl\.es\/p\/[^<\s]+\/p(11\d{6}))\s*<\/loc>/g)) {
      if (seen.has(m[2])) continue; seen.add(m[2]);
      rows.push({ store: 'lidl', ext_id: m[2], url: m[1], status: 'new' });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 1000), { onConflict: 'store,ext_id', ignoreDuplicates: !body.reset });
      if (error) return J({ error: error.message });
    }
    // lo que ya no sale en el sitemap deja de estar a la venta online
    if (body.reset && rows.length > 300) {
      const ids = rows.map(x => x.ext_id);
      const { data: act } = await sb.from('c_items').select('ext_id').eq('store', 'lidl').eq('active', true);
      const gone = (act || []).map((x: any) => x.ext_id).filter((x: string) => !seen.has(x));
      for (let i = 0; i < gone.length; i += 200) await sb.from('c_items').update({ active: false }).eq('store', 'lidl').in('ext_id', gone.slice(i, i + 200));
      return J({ ok: true, products: ids.length, retired: gone.length });
    }
    return J({ ok: true, products: rows.length });
  }

  if (body.action === 'crawl') {
    const t0 = Date.now();
    const { data: q } = await sb.from('c_queue').select('*').eq('store', 'lidl').eq('status', 'new').limit(body.n ?? 30);
    const { data: map } = await sb.from('c_store_cats').select('ext,cat_id').eq('store', 'lidl');
    const catOf = new Map((map || []).map((m: any) => [m.ext, m.cat_id]));
    let saved = 0, bad = 0, blocked = false;
    const cats = new Map<string, any>();
    for (const job of q || []) {
      if (Date.now() - t0 > 100000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404 || r.status === 410) { status = 'gone'; await sb.from('c_items').update({ active: false }).eq('store', 'lidl').eq('ext_id', job.ext_id); }
        else if (r.status !== 200) { status = 'error'; err = 'HTTP ' + r.status; if ([202, 403, 429, 503].includes(r.status)) blocked = true; }
        else {
          const it = parse(await r.text(), job.url);
          if (!it) { status = 'error'; err = 'sin datos'; }
          else {
            const { _raw, ...row } = it;
            if (row.store_cat) {
              const ids = row.store_cat.split('*'); const names = (row.store_cat_path || '').split(' > ');
              for (let i = 1; i <= ids.length; i++) {
                const ext = ids.slice(0, i).join('*');
                if (!cats.has(ext)) cats.set(ext, { store: 'lidl', ext, name: names[i - 1] || ext, path: names.slice(0, i).join(' > ') });
              }
            }
            let cat: string | null = null;
            if (row.store_cat) { const ids = row.store_cat.split('*'); for (let i = ids.length; i > 0 && !cat; i--) cat = catOf.get(ids.slice(0, i).join('*')) || null; }
            const { data: rows, error } = await sb.from('c_items').upsert({ ...row, cat_id: cat, updated_at: new Date().toISOString() }, { onConflict: 'store,ext_id' }).select('id,price,unit_price');
            if (error) { status = 'error'; err = error.message; bad++; }
            else {
              saved++;
              const x: any = rows![0];
              if (x?.price != null) await sb.from('c_price_hist').upsert({ item_id: x.id, price: x.price, unit_price: x.unit_price }, { onConflict: 'item_id,seen_on' });
            }
            void _raw;
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', 'lidl').eq('ext_id', job.ext_id);
      if (blocked) break; // si nos frenan, paramos y no insistimos
      await sleep(1500);
    }
    if (cats.size) await sb.from('c_store_cats').upsert([...cats.values()], { onConflict: 'store,ext', ignoreDuplicates: true });
    return J({ ok: true, picked: (q || []).length, saved, errors: bad, blocked, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
