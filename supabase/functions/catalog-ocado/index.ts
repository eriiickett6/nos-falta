// Catálogo de súpers con tienda online Ocado (Bonpreu/Esclat, Alcampo).
// Leemos las páginas de categoría públicas (robots.txt las permite): cada una trae sus productos con precio.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SITES: Record<string, string> = {
  bonpreu: 'https://www.compraonline.bonpreuesclat.cat',
  alcampo: 'https://www.compraonline.alcampo.es',
};
const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const PAUSE = 1500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const n = (v: unknown) => { const x = parseFloat(String(v ?? '')); return isFinite(x) ? x : null; };

function state(html: string): any {
  const k = html.indexOf('window.__INITIAL_STATE__=');
  if (k < 0) return null;
  const start = k + 'window.__INITIAL_STATE__='.length;
  const end = html.indexOf('</script>', start);
  let s = html.slice(start, end).trim();
  if (s.endsWith(';')) s = s.slice(0, -1);
  return JSON.parse(s);
}
function findKey(o: any, key: string, depth = 0): any {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (o[key] && typeof o[key] === 'object') return o[key];
  for (const k of Object.keys(o)) { const r = findKey(o[k], key, depth + 1); if (r) return r; }
  return null;
}

export function parseSize(label: string | null): { q: number | null, u: string | null, n: number | null } {
  if (!label) return { q: null, u: null, n: null };
  const s = label.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  const conv = (q: number, u: string): [number, string] =>
    u === 'kg' ? [q, 'kg'] : (u === 'g' || u === 'gr') ? [q / 1000, 'kg'] :
    u === 'l' || u === 'lt' ? [q, 'l'] : u === 'ml' ? [q / 1000, 'l'] : u === 'cl' ? [q / 100, 'l'] : [q, u];
  let m = s.match(/(\d+)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|lt|l|ml|cl)\b/);
  if (m) { const [q, u] = conv(+m[2], m[3]); return { q: +(q * +m[1]).toFixed(4), u, n: +m[1] }; }
  m = s.match(/(\d+(?:\.\d+)?)\s*(kg|gr|g|lt|l|ml|cl)\b/);
  if (m) { const [q, u] = conv(+m[1], m[2]); return { q: +q.toFixed(4), u, n: 1 }; }
  m = s.match(/(\d+)\s*(?:u|ud|uds|unitats|unidades)\b/);
  if (m) return { q: +m[1], u: 'ud', n: +m[1] };
  return { q: null, u: null, n: null };
}

const slug = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
function catFromUrl(u: string) {
  const parts = decodeURIComponent(new URL(u).pathname).split('/').filter(Boolean); // categories/a/b/c/<uuid>
  const segs = parts.slice(1, -1);
  return { code: segs.map(slug).join('/'), path: segs.map(x => x.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())).join(' > ') };
}
function toItem(store: string, base: string, e: any, ctx?: { code: string, path: string }) {
  const price = n(e.price?.current?.amount);
  const unitAmt = n(e.price?.unit?.current?.amount);
  const lbl = String(e.price?.unit?.label || '').toLowerCase();
  const unit = /kg|kilo/.test(lbl) ? 'kg' : /litre|liter|litro|\.l$|per\.l\b/.test(lbl) ? 'l' : null;
  const sizeTxt = (typeof e.size === 'string' ? e.size : (e.size?.value || e.size?.label)) || e.packSizeDescription || null;
  const sz = parseSize(typeof sizeTxt === 'string' ? sizeTxt : null);
  const loose = !!(e.weightedProduct || e.isWeighted || e.pricingUnit === 'KG' || /aprox|granel/i.test(String(sizeTxt || '')));
  let net_qty = sz.q, net_unit = sz.u;
  if (!loose && price && unitAmt && unit && (!net_qty || net_unit !== unit)) { net_qty = +(price / unitAmt).toFixed(3); net_unit = unit; }
  const was = n(e.price?.was?.amount ?? e.price?.original?.amount);
  const pslug = String(e.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    store, ext_id: String(e.retailerProductId || e.productId), url: base + '/products/' + pslug + '/' + (e.retailerProductId || e.productId),
    name: String(e.name || '').trim(), brand: e.brand || null, image_url: e.image?.src || null,
    size_label: typeof sizeTxt === 'string' ? sizeTxt : null, net_qty: loose ? null : net_qty, net_unit: loose ? null : net_unit, pack_n: sz.n,
    price, unit_price: unit ? (loose ? (unitAmt ?? price) : unitAmt) : null, unit, loose,
    old_price: was && price && was > price ? was : null, promo_until: null,
    store_cat: ctx ? ctx.code : ((e.categoryPath || []).map((x: string) => slug(x)).join('/') || null),
    store_cat_path: ctx ? ctx.path : ((e.categoryPath || []).join(' > ') || null),
    excluded: false, active: e.available !== false && price != null,
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const store: string = body.store;
  const base = SITES[store];
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  if (!base) return J({ error: 'store' });
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,ca;q=0.8' } });

  if (body.action === 'test') {
    const r = await get(body.url); const html = await r.text();
    const st = state(html); const ents = findKey(st, 'productEntities') || {};
    const vals = Object.values(ents) as any[];
    const cat = findKey(st, 'currentCategory');
    return J({ status: r.status, n: vals.length, cat, raw: vals[0], item: vals[0] ? toItem(store, base, vals[0]) : null });
  }

  if (body.action === 'seed') {
    const r = await get(base + '/sitemaps/sitemap-categories-part1.xml');
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]).filter(u => u.includes('/categories/'));
    // solo hojas: categorías que no son prefijo de otra
    const paths = locs.map(u => ({ u, p: u.replace(/\/[0-9a-f-]{36}$/, '') }));
    const leaves = paths.filter(a => !paths.some(b => b !== a && b.p.startsWith(a.p + '/')));
    const rows = leaves.map(x => ({ store, ext_id: 'cat:' + x.u.split('/').pop(), url: x.u, status: 'new' }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 500), { onConflict: 'store,ext_id' });
      if (error) return J({ error: error.message });
    }
    // fichas sueltas (para los productos que no salen en las 30 primeras de su categoría)
    let prods = 0;
    for (const part of ['sitemap-products-part1.xml', 'sitemap-products-part2.xml', 'sitemap-products-part3.xml']) {
      const rp = await get(base + '/sitemaps/' + part); if (!rp.ok) break;
      const px = await rp.text();
      const pr = [...px.matchAll(/<loc>\s*([^<\s]+\/products\/[^<\s]+\/([0-9A-Za-z]+))\s*<\/loc>/g)].map(m => ({ store, ext_id: 'p:' + m[2], url: m[1], status: 'later' }));
      for (let i = 0; i < pr.length; i += 1000) await sb.from('c_queue').upsert(pr.slice(i, i + 1000), { onConflict: 'store,ext_id', ignoreDuplicates: true });
      prods += pr.length;
    }
    return J({ ok: true, categories: locs.length, leaves: rows.length, products: prods });
  }

  if (body.action === 'crawl') {
    const t0 = Date.now();
    const { data: q } = await sb.from('c_queue').select('*').eq('store', store).eq('status', 'new').limit(body.n ?? 30);
    let saved = 0, bad = 0;
    for (const job of q || []) {
      if (Date.now() - t0 > 100000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404) status = 'gone';
        else if (!r.ok) { status = 'error'; err = 'HTTP ' + r.status; if (r.status === 429 || r.status === 403) await sleep(10000); }
        else {
          const st = state(await r.text());
          const ents = findKey(st, 'productEntities') || {};
          const isCat = String(job.ext_id).startsWith('cat:');
          const ctx = isCat ? catFromUrl(job.url) : undefined;
          let list = (Object.values(ents) as any[]).filter(e => e?.name && (e.retailerProductId || e.productId));
          if (!isCat) { const pid = String(job.ext_id).slice(2); const one = list.find(e => String(e.retailerProductId) === pid); list = one ? [one] : list.slice(0, 1); }
          const items = list.map(e => ({ ...toItem(store, base, e, ctx), updated_at: new Date().toISOString() }));
          const cat = isCat ? findKey(st, 'currentCategory') : null;
          if (cat?.productCount && cat.productCount > items.length) err = 'faltan ' + (cat.productCount - items.length);
          const seen = new Set<string>(); const uniq = items.filter(i => !seen.has(i.ext_id) && seen.add(i.ext_id));
          if (uniq.length) {
            const { data: rows, error } = await sb.from('c_items').upsert(uniq, { onConflict: 'store,ext_id' }).select('id,price,unit_price');
            if (error) { status = 'error'; err = error.message; bad++; }
            else {
              saved += rows!.length;
              const hist = rows!.filter((x: any) => x.price != null).map((x: any) => ({ item_id: x.id, price: x.price, unit_price: x.unit_price }));
              if (hist.length) await sb.from('c_price_hist').upsert(hist, { onConflict: 'item_id,seen_on' });
            }
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', store).eq('ext_id', job.ext_id);
      await sleep(PAUSE);
    }
    return J({ ok: true, picked: (q || []).length, saved, errors: bad, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
