// Catálogo por supermercado (Aldi y bonÀrea) a partir de sus webs públicas.
// Ritmo educado: peticiones en serie con pausa, UA identificado, respeta robots.txt.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const PAUSE = 700;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const SITEMAPS: Record<string, string> = {
  aldi: 'https://www.aldi.es/sitemaps/.aldi-nord-sitemap-products.xml',
  bonarea: 'https://www.bonarea-online.com/sitemap.xml',
};
// bonÀrea: familias excluidas (electrodomésticos, informática)
const BON_EXCLUDE = [/^13\*370/, /^13\*390/];

function decode(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
const num = (s: string | undefined | null) => s == null ? null : Number(String(s).replace(/\./g, '').replace(',', '.'));

export function parseSize(label: string | null): { q: number | null, u: string | null, n: number | null } {
  if (!label) return { q: null, u: null, n: null };
  const s = label.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  const conv = (q: number, u: string): [number, string] =>
    u === 'kg' ? [q, 'kg'] : (u === 'g' || u === 'gr' || u === 'grs') ? [q / 1000, 'kg'] :
    u === 'l' || u === 'litro' || u === 'litros' ? [q, 'l'] : u === 'ml' ? [q / 1000, 'l'] : u === 'cl' ? [q / 100, 'l'] : [q, u];
  let m = s.match(/(\d+)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(kg|grs?|g|litros?|l|ml|cl)\b/);
  if (m) { const [q, u] = conv(+m[2], m[3]); return { q: +(q * +m[1]).toFixed(4), u, n: +m[1] }; }
  m = s.match(/(\d+(?:\.\d+)?)\s*(kg|grs?|g|litros?|l|ml|cl)\b/);
  if (m) { const [q, u] = conv(+m[1], m[2]); return { q: +q.toFixed(4), u, n: 1 }; }
  m = s.match(/(\d+)\s*(?:uds?\.?|unidades|u\.?|rollos|bolsitas|c[aá]psulas|lavados|piezas|sobres|pastillas|monodosis|toallitas|pañales|bolsas)\b/);
  if (m) return { q: +m[1], u: 'ud', n: +m[1] };
  return { q: null, u: null, n: null };
}

type Item = {
  store: string, ext_id: string, url: string, name: string, brand: string | null, image_url: string | null,
  size_label: string | null, net_qty: number | null, net_unit: string | null, pack_n: number | null,
  price: number | null, unit_price: number | null, unit: string | null, loose: boolean, old_price: number | null,
  promo_until: string | null, store_cat: string | null, store_cat_path: string | null, cats?: string[],
  crumbs?: { ref: string, name: string }[], excluded: boolean, active: boolean,
};

function findApiData(o: any): any {
  if (!o || typeof o !== 'object') return null;
  if (typeof o.apiData === 'string') return o.apiData;
  for (const k of Object.keys(o)) { const r = findApiData(o[k]); if (r) return r; }
  return null;
}

function parseAldi(html: string, url: string, ext: string): Item | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const next = JSON.parse(m[1]);
  const api = findApiData(next);
  if (!api) return null;
  const arr = JSON.parse(api);
  let p: any = null;
  for (const e of arr) if (e?.[0] === 'PRODUCT_DETAIL_GET') p = e[1]?.res?.products?.[0];
  if (!p) return null;
  const cp = p.currentPrice || {};
  const bp = (cp.basePrice || [])[0] || {};
  const sales = p.salesUnit ? String(p.salesUnit) : null;
  const sz = parseSize(sales);
  const price = cp.priceValue ?? null;
  const sc = String(bp.basePriceScale || '').toLowerCase().match(/\b(kg|l)\b/);
  let unit: string | null = sc ? sc[1] : null;
  let unit_price = bp.basePriceValue ?? null;
  if (unit && !['kg', 'l'].includes(unit)) { unit_price = null; unit = null; }
  const loose = /granel|aprox|peso variable|al corte|al peso/i.test((sales || '') + ' ' + p.name);
  const img = (p.assets || []).find((a: any) => a.type === 'primary')?.url || p.assets?.[0]?.url || null;
  let net_qty = loose ? null : sz.q, net_unit = loose ? null : sz.u;
  if (!loose && net_qty == null && price && unit_price && unit) { net_qty = +(price / unit_price).toFixed(3); net_unit = unit; }
  if (loose && !unit_price && price) { unit_price = price; unit = 'kg'; }
  const until = cp.validUntil ? new Date(cp.validUntil * 1000).toISOString().slice(0, 10) : null;
  return {
    store: 'aldi', ext_id: String(p.objectID || ext), url, name: decode(String(p.name)), brand: p.brandName ? decode(String(p.brandName)).replace(/®|™/g, '').trim() : null,
    image_url: img ? img + '?wid=400&hei=400' : null, size_label: sales ? sales.replace(/\s*unidad$/i, '') : null,
    net_qty, net_unit, pack_n: sz.n, price, unit_price, unit, loose,
    old_price: cp.strikePrice?.strikePriceValue ?? null, promo_until: cp.strikePrice ? until : null,
    store_cat: p.mainCategoryID || null, store_cat_path: null, cats: p.categoryIDs || [],
    excluded: false, active: !!p.isAvailable && price != null,
  };
}

function parseBon(html: string, url: string, ext: string): Item | null {
  const h1 = html.match(/<h1 class=title>([\s\S]*?)<\/h1>/);
  if (!h1) return null;
  const name = decode(h1[1]);
  const sub = html.match(/<h1 class=title>[\s\S]*?<\/h1>\s*<div class=subtitle>([\s\S]*?)<\/div>/);
  const size = sub ? decode(sub[1]) : null;
  const cp = html.match(/<div class=content-price>([\s\S]*?)<\/div>/);
  let price: number | null = null, punit: string | null = null, unit_price: number | null = null, unit: string | null = null, old: number | null = null;
  if (cp) {
    const block = cp[1];
    const main = block.match(/<span class="?h2 bold"?>\s*([\d.,]+)\s*€\s*\/\s*([a-z]+)/i);
    if (main) { price = num(main[1]); punit = main[2].toLowerCase(); }
    const kl = block.match(/price-kl>\s*\(\s*([\d.,]+)\s*€\s*\/\s*([a-z]+)/i);
    if (kl) { unit_price = num(kl[1]); unit = kl[2].toLowerCase(); }
    const o = block.match(/<(?:del|s)\b[^>]*>\s*([\d.,]+)\s*€|class="?[^">]*(?:price-old|old-price|tachad|precio-anterior)[^">]*"?>\s*([\d.,]+)\s*€/i);
    if (o) old = num(o[1] ?? o[2]);
  }
  const approx = /^\s*aprox/i.test(size || '');
  const loose = punit === 'kg' || punit === 'l' || approx;
  if (punit === 'kg' || punit === 'l') { unit_price = price; unit = punit; }
  if (unit && !['kg', 'l'].includes(unit)) { unit_price = null; unit = null; }
  const crumbs = [...html.matchAll(/class="modal-breadcrumb[^"]*"\s+data-url=\S+\s+data-ref=([0-9*]+)>([^<]+)<\/a>/g)].map(m => ({ ref: m[1], name: decode(m[2]) }));
  const last = crumbs[crumbs.length - 1];
  const sz = parseSize(size);
  let net_qty = sz.q, net_unit = sz.u;
  if ((!loose || approx) && price && unit_price && unit && (net_qty == null || net_unit !== unit)) { net_qty = +(price / unit_price).toFixed(3); net_unit = unit; }
  const img = html.match(/https:\/\/images\.bonarea\.com\/[0-9_]+_1\.png/);
  const ref = last?.ref || null;
  return {
    store: 'bonarea', ext_id: ext, url, name, brand: null, image_url: img ? img[0] + '?width=400&height=400' : null,
    size_label: size, net_qty: approx || !loose ? net_qty : null, net_unit: approx || !loose ? net_unit : null, pack_n: sz.n,
    price, unit_price, unit, loose, old_price: old, promo_until: null,
    store_cat: ref, store_cat_path: crumbs.map(c => c.name).join(' > ') || null, crumbs,
    excluded: !ref || BON_EXCLUDE.some(re => re.test(ref)), active: price != null,
  };
}

async function get(url: string): Promise<Response> {
  return await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, redirect: 'follow' });
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const store: string = body.store;
  if (!SITEMAPS[store]) return new Response(JSON.stringify({ error: 'store' }), { status: 400 });
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });

  if (body.action === 'seed') {
    const r = await get(SITEMAPS[store]);
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
    const rows: { store: string, ext_id: string, url: string }[] = [];
    const seen = new Set<string>();
    for (const u of locs) {
      let id: string | null = null;
      if (store === 'aldi') { const m = u.match(/aldi\.es\/producto\/[^/]*-(\d+)\.html$/); if (m) id = m[1]; }
      else { const m = u.match(/bonarea-online\.com\/online\/producto\/[^/]+\/(\d+_\d+)$/); if (m) id = m[1]; }
      if (id && !seen.has(id)) { seen.add(id); rows.push({ store, ext_id: id, url: u }); }
    }
    let ins = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 500), { onConflict: 'store,ext_id', ignoreDuplicates: true });
      if (error) return J({ error: error.message, at: i });
      ins += Math.min(500, rows.length - i);
    }
    return J({ ok: true, store, status: r.status, locs: locs.length, products: rows.length });
  }

  if (body.action === 'test') {
    const out: unknown[] = [];
    for (const u of (body.urls || []).slice(0, 5)) {
      const r = await get(u); const html = await r.text();
      const ext = store === 'aldi' ? (u.match(/-(\d+)\.html/)?.[1] ?? u) : (u.match(/(\d+_\d+)$/)?.[1] ?? u);
      try { out.push({ u, status: r.status, item: store === 'aldi' ? parseAldi(html, u, ext) : parseBon(html, u, ext) }); }
      catch (e) { out.push({ u, status: r.status, err: String(e) }); }
      await sleep(PAUSE);
    }
    return J(out);
  }

  if (body.action === 'crawl') {
    const n = Math.min(body.n ?? 25, 60);
    const t0 = Date.now();
    const stale = new Date(Date.now() - 20 * 3600e3).toISOString();
    let { data: q } = await sb.from('c_queue').select('*').eq('store', store).eq('status', 'new').limit(n);
    if (!q || q.length === 0) {
      const r2 = await sb.from('c_queue').select('*').eq('store', store).in('status', ['done', 'error', 'skip']).lt('last_at', stale).lt('tries', 6).order('last_at').limit(n);
      q = r2.data || [];
    }
    const { data: map } = await sb.from('c_store_cats').select('ext,cat_id').eq('store', store);
    const catOf = new Map((map || []).map((m: any) => [m.ext, m.cat_id]));
    let ok = 0, bad = 0, skip = 0;
    for (const job of q) {
      if (Date.now() - t0 > 110000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404 || r.status === 410) { status = 'gone'; await sb.from('c_items').update({ active: false }).eq('store', store).eq('ext_id', job.ext_id); }
        else if (r.status === 429 || r.status === 403) { status = 'error'; err = 'HTTP ' + r.status; await sleep(5000); }
        else if (!r.ok) { status = 'error'; err = 'HTTP ' + r.status; }
        else {
          const html = await r.text();
          const it = store === 'aldi' ? parseAldi(html, job.url, job.ext_id) : parseBon(html, job.url, job.ext_id);
          if (!it) { status = 'skip'; err = 'sin datos'; skip++; }
          else {
            let cat: string | null = null;
            if (store === 'aldi') {
              const ids = [...new Set([it.store_cat, ...(it.cats || [])].filter(Boolean) as string[])];
              await sb.from('c_store_cats').upsert(ids.map(x => ({ store, ext: x, name: x })), { onConflict: 'store,ext', ignoreDuplicates: true });
              for (const c of ids) if (catOf.get(c)) { cat = catOf.get(c)!; it.store_cat = c; break; }
            } else {
              if (it.crumbs?.length) {
                const rows = it.crumbs.map((c, i) => ({ store, ext: c.ref, name: c.name, path: it.crumbs!.slice(0, i + 1).map(x => x.name).join(' > ') }));
                await sb.from('c_store_cats').upsert(rows, { onConflict: 'store,ext', ignoreDuplicates: true });
                for (let i = it.crumbs.length - 1; i >= 0 && !cat; i--) cat = catOf.get(it.crumbs[i].ref) || null;
              }
            }
            const { cats, crumbs: _k, ...row } = it;
            const { data: saved, error } = await sb.from('c_items').upsert({ ...row, store_cats: cats ?? null, cat_id: cat, updated_at: new Date().toISOString() }, { onConflict: 'store,ext_id' }).select('id').single();
            if (error) { status = 'error'; err = error.message; bad++; }
            else {
              ok++;
              if (it.price != null) await sb.from('c_price_hist').upsert({ item_id: saved.id, price: it.price, unit_price: it.unit_price }, { onConflict: 'item_id,seen_on' });
            }
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', store).eq('ext_id', job.ext_id);
      await sleep(PAUSE);
    }
    return J({ ok: true, store, picked: q.length, saved: ok, skipped: skip, errors: bad, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
