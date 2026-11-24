// Catálogo de Condis (compraonline.condis.es).
// robots.txt permite todo menos /private/ y publica un sitemap con todas las fichas de producto.
// Cada ficha trae los datos del producto (precio, cantidad, categoría) en el HTML que sirve el servidor.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BASE = 'https://compraonline.condis.es';
const IMG = 'https://cdn.condis.es/fit-in/400x400/es/products/';
const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const PAUSE = 1200;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const num = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));

// junta los trozos self.__next_f.push([1,"..."]) en un solo texto
function rsc(html: string): string {
  let out = '';
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { try { out += JSON.parse(m[1]); } catch { /* trozo raro */ } }
  return out;
}
function objAt(s: string, start: number): any {
  let d = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  return null;
}

export function parseNet(t: string | null): { q: number | null, u: string | null } {
  if (!t) return { q: null, u: null };
  const m = t.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(kilos?|kg|gramos?|gr|g|litros?|l|mililitros?|ml|centilitros?|cl|unidad(?:es)?|uds?|u)\b/);
  if (!m) return { q: null, u: null };
  const q = parseFloat(m[1].replace(',', '.')); const u = m[2];
  if (/^(kilo|kg)/.test(u)) return { q, u: 'kg' };
  if (/^(gramo|gr|g$)/.test(u)) return { q: +(q / 1000).toFixed(4), u: 'kg' };
  if (/^(mililitro|ml)/.test(u)) return { q: +(q / 1000).toFixed(4), u: 'l' };
  if (/^(centilitro|cl)/.test(u)) return { q: +(q / 100).toFixed(4), u: 'l' };
  if (/^(litro|l$)/.test(u)) return { q, u: 'l' };
  return { q, u: 'ud' };
}
const fmt = (q: number, u: string) => (u === 'kg' && q < 1 ? Math.round(q * 1000) + ' g' : u === 'l' && q < 1 ? Math.round(q * 1000) + ' ml' : String(+q.toFixed(3)).replace('.', ',') + ' ' + u);
const cap = (s: string) => s.toLowerCase().replace(/^./, c => c.toUpperCase());

function parse(html: string, url: string) {
  const s = rsc(html);
  const k = s.indexOf('"productInformation":');
  if (k < 0) return null;
  const p = objAt(s, s.indexOf('{', k));
  if (!p?.ID) return null;
  // categoría: el objeto padre con sus hijos (ids tipo c01__cat00020001__cat000200010004)
  const leafId = String(p.parent_category_id || '');
  const top = (s.match(/"parentCategoryName":"([^"]*)"/) || [])[1] || '';
  let code = '', path = '';
  const full = leafId ? (s.match(new RegExp('"id":"(c\\d+__[^"]*__' + leafId + ')"')) || [])[1] : null;
  if (full) {
    const ids = full.split('__');
    const midName = (s.match(new RegExp('"name":"([^"]*)","externalId":"' + ids[1] + '","children"')) || [])[1] || '';
    code = ids.join('*');
    path = [top, midName, p.parent_category_description].filter(Boolean).join(' > ');
  } else if (leafId) { code = '?*' + leafId; path = [top, p.parent_category_description].filter(Boolean).join(' > '); }

  const sale = Number(p.sale_price), list = Number(p.list_price);
  // sale_price solo viene relleno cuando hay oferta; si no, el precio es list_price
  const pc = isFinite(sale) && sale > 0 ? sale : (isFinite(list) && list > 0 ? list : NaN);
  const price = isFinite(pc) ? pc / 100 : null;
  const um = String(p.um_price || '');
  const mu = um.match(/([\d.,]+)\s*€\s*\/\s*(kg|kilo|litro|l)\b/i);
  const unit = mu ? (/^l/i.test(mu[2]) ? 'l' : 'kg') : null;
  const unitAmt = mu ? num(mu[1]) : null;
  const loose = !!p.variable_weight;
  const net = parseNet(p.net_amount || null);
  let net_qty = net.q, net_unit = net.u;
  if (!loose && price && unitAmt && unit && (!net_qty || net_unit !== unit)) { net_qty = +(price / unitAmt).toFixed(3); net_unit = unit; }
  const name = cap(String(p.description || '').trim());
  let size_label: string | null = null;
  if (loose) size_label = p.avg_weight ? 'aprox. ' + fmt(Number(p.avg_weight) / (Number(p.avg_weight) > 20 ? 1000 : 1), 'kg') : 'a granel';
  else if (net_qty && net_unit) size_label = fmt(net_qty, net_unit);
  const img = (Array.isArray(p.alt_images) && p.alt_images[0]) ? String(p.alt_images[0]).replace(/\.jpg$/i, '') : String(p.ID);
  return {
    store: 'condis', ext_id: String(p.ID), url,
    name, brand: p.brand ? String(p.brand) : null, image_url: IMG + img + '.jpg',
    size_label, net_qty: loose ? null : net_qty, net_unit: loose ? null : net_unit, pack_n: null,
    price, unit_price: unit ? (unitAmt ?? null) : null, unit, loose,
    old_price: isFinite(list) && sale > 0 && list > sale ? list / 100 : null, promo_until: null,
    store_cat: code || null, store_cat_path: path || null, cat_top: top,
    excluded: /electr|tecnolog|informát/i.test(top), active: price != null,
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const get = (u: string, method = 'GET') => fetch(u, { method, headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });

  if (body.action === 'test') {
    const r = await get(body.url); const html = await r.text();
    const it = parse(html, body.url);
    const imgs: any = {};
    for (const u of body.imgs || []) { try { const x = await get(u, 'HEAD'); imgs[u] = x.status + ' ' + x.headers.get('content-type'); } catch (e) { imgs[u] = String(e); } }
    let raw: any = null;
    if (body.raw) { const s = rsc(html); const k = s.indexOf('"productInformation":'); const p = k >= 0 ? objAt(s, s.indexOf('{', k)) : null; if (p) { delete p.nutritional_info; delete p.ingredients; delete p.wine_info; } raw = p; }
    return J({ status: r.status, item: it, imgs, raw });
  }

  if (body.action === 'seed') {
    const seen = new Set<string>(); const rows: any[] = []; const maps: string[] = [];
    const queue = [BASE + '/sitemap.xml'];
    while (queue.length && maps.length < 40) {
      const u = queue.shift()!; maps.push(u);
      const r = await get(u); if (!r.ok) continue;
      const xml = await r.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const loc = m[1].replace(/&amp;/g, '&');
        if (/\.xml(\.gz)?$/.test(loc) || /sitemap/i.test(loc) && !/\/p\//.test(loc)) { if (!maps.includes(loc) && !queue.includes(loc)) queue.push(loc); continue; }
        const pm = loc.match(/\/p\/(\d+)\/es_ES$/);
        if (pm && !seen.has(pm[1])) { seen.add(pm[1]); rows.push({ store: 'condis', ext_id: pm[1], url: loc, status: 'new' }); }
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 1000), { onConflict: 'store,ext_id', ignoreDuplicates: !body.reset });
      if (error) return J({ error: error.message });
    }
    return J({ ok: true, maps: maps.length, products: rows.length });
  }

  if (body.action === 'crawl') {
    const t0 = Date.now();
    const { data: q } = await sb.from('c_queue').select('*').eq('store', 'condis').eq('status', 'new').order('prio', { ascending: false }).limit(body.n ?? 40);
    const { data: map } = await sb.from('c_store_cats').select('ext,cat_id').eq('store', 'condis');
    const catOf = new Map((map || []).map((m: any) => [m.ext, m.cat_id]));
    let saved = 0, bad = 0, blocked = false;
    const cats = new Map<string, any>();
    for (const job of q || []) {
      if (Date.now() - t0 > 100000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404 || r.status === 410) status = 'gone';
        else if (!r.ok || r.status !== 200) { status = 'error'; err = 'HTTP ' + r.status; if ([202, 403, 429, 503].includes(r.status)) blocked = true; }
        else {
          const it = parse(await r.text(), job.url);
          if (!it) { status = 'error'; err = 'sin datos'; }
          else {
            const { cat_top, ...row } = it;
            if (row.store_cat) {
              const ids = row.store_cat.split('*'); const names = (row.store_cat_path || '').split(' > ');
              for (let i = 1; i <= ids.length; i++) {
                const ext = ids.slice(0, i).join('*');
                if (!cats.has(ext)) cats.set(ext, { store: 'condis', ext, name: names[i - 1] || ext, path: names.slice(0, i).join(' > ') });
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
            void cat_top;
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', 'condis').eq('ext_id', job.ext_id);
      if (blocked) break; // si el servidor nos frena, paramos y no insistimos
      await sleep(PAUSE);
    }
    if (cats.size) await sb.from('c_store_cats').upsert([...cats.values()], { onConflict: 'store,ext', ignoreDuplicates: true });
    return J({ ok: true, picked: (q || []).length, saved, errors: bad, blocked, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
