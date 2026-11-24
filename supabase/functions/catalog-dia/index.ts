// Catálogo de Dia (www.dia.es).
// robots.txt permite las fichas /<categoría>/<subcategoría>/p/<id> y publica un sitemap con todas.
// Cada ficha trae nombre, foto y precio en JSON-LD (schema.org) y el precio por kilo/litro en el HTML.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BASE = 'https://www.dia.es';
const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const PAUSE = 1200;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const num = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
const unent = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const human = (slug: string) => { const t = slug.replace(/-/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

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
function parseNet(t: string): { q: number | null, u: string | null, n: number } {
  const s = t.toLowerCase();
  const pk = s.match(/(\d{1,2})\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ml|cl)\b/);
  const m = pk ? [pk[0], pk[2], pk[3]] : s.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|gramos|l|litros?|ml|cl)\b/);
  if (!m) return { q: null, u: null, n: 1 };
  const n = pk ? parseInt(pk[1]) : 1;
  let q = parseFloat(String(m[1]).replace(',', '.')); const u = String(m[2]);
  if (/^(g|gr|gramos)$/.test(u)) q = q / 1000; else if (u === 'ml') q = q / 1000; else if (u === 'cl') q = q / 100;
  return { q: +(q * n).toFixed(4), u: /^(kg|kilo|g|gr|gramos)/.test(u) ? 'kg' : 'l', n };
}
const fmt = (q: number, u: string) => (u === 'kg' && q < 1 ? Math.round(q * 1000) + ' g' : u === 'l' && q < 1 ? Math.round(q * 1000) + ' ml' : String(+q.toFixed(3)).replace('.', ',') + ' ' + u);

function parse(html: string, url: string) {
  const id = (url.match(/\/p\/(\d+)/) || [])[1];
  if (!id) return null;
  let ld: any = null;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!/"Product"/.test(m[1])) continue;
    try { const j = JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, ' ')); if (j['@type'] === 'Product') { ld = j; break; } }
    catch { // JSON mal formado: sacamos los campos a mano
      const g = (k: string) => (m[1].match(new RegExp('"' + k + '"\\s*:\\s*"?([^",}\\n]+)')) || [])[1];
      ld = { name: g('name'), image: g('image'), offers: { price: g('price') } }; break;
    }
  }
  if (!ld?.name) return null;
  const b = html.indexOf('data-test-id="buy-box"');
  const box = b >= 0 ? html.slice(b, b + 4000) : '';
  const ap = box.match(/buy-box-active-price"[^>]*>\s*([\d.,]+)\s*€/);
  const price = ap ? num(ap[1]) : (ld.offers?.price != null ? Number(ld.offers.price) : null);
  const pu = box.match(/buy-box-price-per-unit"[^>]*>\s*\(\s*([\d.,]+)\s*€\s*\/\s*([A-ZÁÉÍÓÚa-z]+)/);
  const unit = pu ? (/^kilo/i.test(pu[2]) ? 'kg' : /^litro/i.test(pu[2]) ? 'l' : null) : null;
  const unit_price = unit && pu ? num(pu[1]) : null;
  const cr = (b >= 0 ? html.slice(Math.max(0, b - 6000), b + 4000) : html).match(/buy-box__crossed-price[^"]*"[^>]*>\s*([\d.,]+)\s*€/);
  const old = cr ? num(cr[1]) : null;
  const name = unent(String(ld.name)).trim();
  const net = parseNet(name);
  let net_qty = net.q, net_unit = net.u;
  if (price && unit_price && unit && (!net_qty || net_unit !== unit)) { net_qty = +(price / unit_price).toFixed(3); net_unit = unit; }
  const loose = /granel|al peso/i.test(name);
  const seg = new URL(url).pathname.split('/').filter(Boolean); // [cat, sub, 'p', id]
  const cat = seg[0] || '', sub = seg[1] && seg[1] !== 'p' ? seg[1] : '';
  const brandM = html.match(/"brand"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/) || html.match(/data-test-id="product-brand"[^>]*>([^<]+)</);
  return {
    store: 'dia', ext_id: id, url,
    name, brand: brandM ? unent(brandM[1]).trim() : null,
    image_url: typeof ld.image === 'string' ? ld.image : (Array.isArray(ld.image) ? ld.image[0] : null),
    size_label: net_qty && net_unit ? (net.n > 1 ? net.n + ' x ' + fmt(net_qty / net.n, net_unit) : fmt(net_qty, net_unit)) : null,
    net_qty, net_unit, pack_n: net.n > 1 ? net.n : null,
    price, unit_price, unit, loose,
    old_price: old && price && old > price ? old : null, promo_until: null, promo_text: promoOf((() => { const d = html.indexOf('pdp-view__discounts-section'); return d >= 0 ? html.slice(d, html.indexOf('buy-box__prices-container', d) > d ? html.indexOf('buy-box__prices-container', d) : d + 1500) : ''; })()),
    store_cat: sub ? cat + '*' + sub : cat || null,
    store_cat_path: [human(cat), sub ? human(sub) : null].filter(Boolean).join(' > ') || null,
    excluded: /^(electrodomesticos|hogar-y-electronica|bazar)/.test(cat), active: price != null,
    _cats: [cat ? { ext: cat, name: human(cat), path: human(cat) } : null, sub ? { ext: cat + '*' + sub, name: human(sub), path: human(cat) + ' > ' + human(sub) } : null].filter(Boolean),
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xml,application/json,text/plain', 'Accept-Language': 'es-ES,es;q=0.9' } });

  if (body.action === 'test') {
    const r = await get(body.url); const html = await r.text();
    const b = html.indexOf('data-test-id="buy-box"');
    return J({ status: r.status, item: parse(html, body.url), len: html.length, head: html.slice(0, 300), ld: (html.match(/<script[^>]*ld\+json[^>]*>[\s\S]{0,600}/g) || []).slice(0, 3), box: body.raw ? html.slice(Math.max(0, b - 3000), b + 2500) : undefined });
  }

  if (body.action === 'seed') {
    const r = await get(BASE + '/sitemap.xml'); if (!r.ok) return J({ error: 'sitemap ' + r.status });
    const xml = await r.text(); const seen = new Set<string>(); const rows: any[] = [];
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+\/p\/(\d+))\s*<\/loc>/g)) {
      if (seen.has(m[2])) continue; seen.add(m[2]);
      rows.push({ store: 'dia', ext_id: m[2], url: m[1].replace(/&amp;/g, '&'), status: 'new' });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 1000), { onConflict: 'store,ext_id', ignoreDuplicates: !body.reset });
      if (error) return J({ error: error.message });
    }
    return J({ ok: true, products: rows.length });
  }

  if (body.action === 'crawl') {
    const t0 = Date.now();
    const { data: q } = await sb.from('c_queue').select('*').eq('store', 'dia').eq('status', 'new').order('prio', { ascending: false }).limit(body.n ?? 40);
    let saved = 0, bad = 0, blocked = false;
    const cats = new Map<string, any>();
    for (const job of q || []) {
      if (Date.now() - t0 > 100000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404 || r.status === 410) status = 'gone';
        else if (r.status !== 200) { status = 'error'; err = 'HTTP ' + r.status; if ([202, 403, 429, 503].includes(r.status)) blocked = true; }
        else {
          const it = parse(await r.text(), r.url || job.url);
          if (!it) { status = 'error'; err = 'sin datos'; }
          else {
            const { _cats, ...row } = it;
            for (const c of _cats as any[]) if (!cats.has(c.ext)) cats.set(c.ext, { store: 'dia', ...c });
            const { data: rows, error } = await sb.from('c_items').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'store,ext_id' }).select('id,price,unit_price');
            if (error) { status = 'error'; err = error.message; bad++; }
            else {
              saved++;
              const x: any = rows![0];
              if (x?.price != null) await sb.from('c_price_hist').upsert({ item_id: x.id, price: x.price, unit_price: x.unit_price }, { onConflict: 'item_id,seen_on' });
            }
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', 'dia').eq('ext_id', job.ext_id);
      if (blocked) break; // si el servidor nos frena, paramos y no insistimos
      await sleep(PAUSE);
    }
    if (cats.size) await sb.from('c_store_cats').upsert([...cats.values()], { onConflict: 'store,ext', ignoreDuplicates: true });
    return J({ ok: true, picked: (q || []).length, saved, errors: bad, blocked, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
