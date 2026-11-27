// Catálogo de Lidl España (www.lidl.es): solo productos de tienda (fichas p11…), no el bazar online.
// robots.txt permite /p/; el sitemap da la lista y la API de cuadrícula (/p/api/gridboxes) los datos, de 20 en 20.
// (El lector antiguo, ficha a ficha, está en el historial de git.)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BASE = 'https://www.lidl.es';
const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
function parseSize(t: string | null): { q: number | null, u: string | null, n: number | null } {
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

// Ficha de la API de cuadrícula de lidl.es (/p/api/gridboxes): la misma que usa su web para pintar listados, 20 productos por petición.
function fromGrid(x: any) {
  if (!x || !x.erpNumber) return null;
  const kf = x.keyfacts || {};
  // Dónde pone Lidl cada precio (API de cuadrícula):
  //  - regionsPrices[r].currentPrice: precio normal completo (tachado, texto "-50% 2a ud.", fechas).
  //  - regionsPrices[r].currentLidlPlusPrice: oferta solo con Lidl Plus (price + highlightText "-50% 2a ud.").
  //  - x.price y x.lidlPlus: resúmenes que a veces NO traen el texto de la promo ni el tachado. Solo de reserva.
  const regs = Object.values(x.regionsPrices || {}) as any[];
  const cur = regs.map((r: any) => r?.currentPrice).find((c: any) => typeof c?.price === 'number');
  const curPlus = regs.map((r: any) => r?.currentLidlPlusPrice).find((c: any) => typeof c?.price?.price === 'number');
  const name = String(x.fullTitle || kf.fullTitle || x.title || '').trim();
  if (!name) return null;
  const lpSum = (x.lidlPlus || []).find((l: any) => typeof l?.price?.price === 'number');
  const keepPack = (o: any) => ({ ...o, packaging: o.packaging?.text ? o.packaging : x.price?.packaging, basePrice: o.basePrice?.text ? o.basePrice : x.price?.basePrice });
  let pr: any, plus = false, plusTxt: string | null = null, extra = '';
  if (cur) pr = keepPack(cur);
  else if (typeof x.price?.price === 'number') pr = x.price;
  else if (curPlus || lpSum) {
    // sin precio normal: la oferta es solo con Lidl Plus (su app gratuita)
    plus = true;
    const src = curPlus || lpSum;
    pr = keepPack(src.price);
    plusTxt = String(src.lidlPlusText || 'Con Lidl Plus');
    extra = [src.highlightText, lpSum?.highlightText].filter(Boolean).join(' | ');
  } else pr = x.price || {};
  const multi0 = promoOf([pr.discount?.discountText, extra, ...((x.ribbons || []).map((r: any) => r?.text))].filter(Boolean).join(' | '));
  const multi = multi0 && plus ? multi0 + ' con Lidl Plus' : multi0;
  const del = num(pr.oldPrice ?? pr.discount?.deletedPrice);
  // "-50% 2a ud.": el precio grande es el de la 2ª unidad; el normal (lo que pagas por una) es el tachado
  // si Lidl no da el tachado, el precio de una unidad sale del % ("-50% 2a ud." y 1,15 € → 2,30 €)
  const pct2 = (multi || '').match(/unidad al (\d+)%/);
  const price = multi && del ? del : multi && pct2 && num(pr.price) ? +(num(pr.price)! / (1 - +pct2[1] / 100)).toFixed(2) : num(pr.price);
  const old = multi ? null : del;
  const pack = String(pr.packaging?.text || '').trim();
  const bp = String(pr.basePrice?.text || '').trim();
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
  const names = wName.split('/').slice(2);
  const ids = wPath.split('/').filter(Boolean).slice(1);
  const end = pr.endDate ? String(pr.endDate).slice(0, 10) : null;
  const badge = (x.stockAvailability?.badgeInfo?.badges || []).map((b: any) => b?.text).filter(Boolean).join(' · ') || null;
  return {
    store: 'lidl', ext_id: String(x.erpNumber), url: x.canonicalUrl ? BASE + x.canonicalUrl : null,
    name, brand: x.brand?.name || null, image_url: x.image || null,
    size_label: loose ? (pack ? pack.replace(/(\d)(kg|g|l|ml)\b/i, '$1 $2') : 'a granel') : (pack ? pack.replace(/(\d)(kg|g|l|ml)\b/i, '$1 $2') : (net_qty && net_unit ? fmt(net_qty, net_unit) : null)),
    net_qty: loose ? null : net_qty, net_unit: loose ? null : net_unit, pack_n: sz.n && sz.n > 1 ? sz.n : null,
    price, unit_price: u2 ? unit_price : null, unit: u2, loose,
    old_price: old && price && old > price ? old : null, promo_until: (old && price && old > price) || multi ? end : null, promo_text: multi || (plus ? plusTxt : null),
    store_cat: ids.length ? ids.join('*') : null, store_cat_path: names.length ? names.join(' > ') : (x.category || null),
    excluded: /electr|inform\u00e1t|ropa|calzado|herramient|bricolaje|juguete|deporte|muebl/i.test(wName),
    active: price != null, _badge: badge,
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });

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

  if (body.action === 'grid') {
    // lee los productos pendientes de 20 en 20 con la API de cuadrícula (mucho menos tráfico que una página por producto)
    const t0 = Date.now(); const per = 20; const reqs = Math.min(body.n ?? 10, 30);
    const { data: q } = await sb.from('c_queue').select('*').eq('store', 'lidl').eq('status', 'new').order('prio', { ascending: false }).limit(per * reqs);
    const { data: map } = await sb.from('c_store_cats').select('ext,cat_id').eq('store', 'lidl');
    const catOf = new Map((map || []).map((m: any) => [m.ext, m.cat_id]));
    const cats = new Map<string, any>();
    let saved = 0, gone = 0, kept = 0, bad = 0, calls = 0, blocked = false, msg = '';
    for (let k = 0; k < (q || []).length; k += per) {
      if (Date.now() - t0 > 95000) break;
      const jobs = q!.slice(k, k + per);
      const ids = jobs.map((j: any) => j.ext_id);
      const r = await get(`${BASE}/p/api/gridboxes/ES/es?erpNumbers=${ids.join(',')}`); calls++;
      if (r.status !== 200) { msg = 'HTTP ' + r.status; if ([202, 403, 429, 503].includes(r.status)) blocked = true; break; }
      let arr: any[] = [];
      try { arr = await r.json(); } catch { msg = 'json'; break; }
      const byId = new Map(arr.map((x: any) => [String(x?.erpNumber), x]));
      const rows: any[] = []; const st = new Map<string, string>();
      // los que siguen sin precio: no borrar un precio de Open Prices si lo hay
      const { data: ex } = await sb.from('c_items').select('ext_id,price_src').eq('store', 'lidl').in('ext_id', ids);
      const srcOf = new Map((ex || []).map((e: any) => [e.ext_id, e.price_src]));
      for (const id of ids) {
        const it = fromGrid(byId.get(id));
        if (!it) { st.set(id, 'gone'); continue; }
        const { _badge, ...row } = it;
        if (row.store_cat) {
          const cs = row.store_cat.split('*'); const ns = (row.store_cat_path || '').split(' > ');
          for (let i = 1; i <= cs.length; i++) { const e = cs.slice(0, i).join('*'); if (!cats.has(e)) cats.set(e, { store: 'lidl', ext: e, name: ns[i - 1] || e, path: ns.slice(0, i).join(' > ') }); }
        }
        let cat: string | null = null;
        if (row.store_cat) { const cs = row.store_cat.split('*'); for (let i = cs.length; i > 0 && !cat; i--) cat = catOf.get(cs.slice(0, i).join('*')) || null; }
        const up: any = { ...row, cat_id: cat, updated_at: new Date().toISOString(), price_src: row.price != null ? 'web' : null, price_date: null };
        if (!up.url) up.url = jobs.find((j: any) => j.ext_id === id)?.url;
        if (row.price == null && srcOf.get(id) === 'openprices') {
          // sin precio en Lidl pero con uno de Open Prices: se actualiza aparte sin tocar el precio (en bloque se borraría)
          const keep: any = { ...up }; for (const f of ['price', 'unit_price', 'unit', 'old_price', 'promo_until', 'promo_text', 'active', 'net_qty', 'net_unit', 'size_label', 'price_src', 'price_date']) delete keep[f];
          await sb.from('c_items').update(keep).eq('store', 'lidl').eq('ext_id', id); kept++; st.set(id, 'done'); continue;
        }
        rows.push(up); st.set(id, 'done');
      }
      if (rows.length) {
        const { data: saved2, error } = await sb.from('c_items').upsert(rows, { onConflict: 'store,ext_id' }).select('id,ext_id,price,unit_price,price_src');
        if (error) { msg = error.message.slice(0, 200); bad += rows.length; for (const r2 of rows) st.set(r2.ext_id, 'error'); }
        else {
          saved += rows.length;
          const hist = (saved2 || []).filter((x: any) => x.price != null && x.price_src === 'web').map((x: any) => ({ item_id: x.id, price: x.price, unit_price: x.unit_price }));
          if (hist.length) await sb.from('c_price_hist').upsert(hist, { onConflict: 'item_id,seen_on' });
        }
      }
      const goneIds = [...st].filter(([, v]) => v === 'gone').map(([id]) => id);
      if (goneIds.length) { gone += goneIds.length; await sb.from('c_items').update({ active: false }).eq('store', 'lidl').in('ext_id', goneIds); }
      const now = new Date().toISOString();
      for (const v of ['done', 'gone', 'error']) {
        const these = [...st].filter(([, s2]) => s2 === v).map(([id]) => id);
        if (these.length) await sb.from('c_queue').update({ status: v, err: v === 'error' ? msg : null, last_at: now, tries: 0 }).eq('store', 'lidl').in('ext_id', these);
      }
      await sleep(body.pause ?? 1200);
    }
    if (cats.size) await sb.from('c_store_cats').upsert([...cats.values()], { onConflict: 'store,ext', ignoreDuplicates: true });
    return J({ ok: true, picked: (q || []).length, calls, saved, sin_precio_conservado: kept, gone, errors: bad, blocked, msg, ms: Date.now() - t0 });
  }

  return J({ error: 'action' });
});
