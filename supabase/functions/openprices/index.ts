// Precios de Open Prices (Open Food Facts, datos abiertos ODbL): precios que la gente sube desde sus tickets y etiquetas.
// Sirve para cadenas cuya web no deja leer el catálogo (Alcampo, Carrefour...). Se guarda el precio más reciente de cada producto.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
const UA = 'NosFalta/0.1 (proyecto educativo FP; lista de la compra)';
const API = 'https://prices.openfoodfacts.org/api/v1';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function getJson(u: string) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    throw new Error('HTTP ' + r.status + ' ' + u);
  }
  throw new Error('reintentos agotados ' + u);
}
const fmt = (q: number, u: string) => (u === 'kg' && q < 1 ? Math.round(q * 1000) + ' g' : u === 'l' && q < 1 ? Math.round(q * 1000) + ' ml' : String(+q.toFixed(3)).replace('.', ',') + ' ' + u);

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const b = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const store = String(b.store || ''); const names: string[] = b.names || [];
  if (!store || !names.length) return J({ error: 'store y names' });
  const since = b.since || '2025-01-01'; const t0 = Date.now(); const budget = b.ms ?? 110000;

  let { data: run } = await sb.from('import_runs').select('*').eq('kind', 'op_c').eq('store_id', store).eq('status', 'running').order('id').limit(1).maybeSingle();
  if (!run) {
    if (!b.restart) return J({ ok: true, idle: true });
    const { data } = await sb.from('import_runs').insert({ kind: 'op_c', store_id: store, cursor: { locs: null, page: 1 } }).select().single(); run = data;
  }
  const c = run.cursor; let ok = run.items_ok ?? 0, failed = run.items_failed ?? 0, msg = '';
  try {
    if (!c.locs) {
      // tiendas de la cadena en España con algún precio
      const ids = new Set<number>();
      for (const n of names) {
        let p = 1;
        while (true) {
          const j = await getJson(`${API}/locations?osm_name__like=${encodeURIComponent(n)}&price_count__gte=1&size=100&page=${p}`);
          for (const l of j.items || []) if (l.osm_address_country_code === 'ES' || /espa/i.test(l.osm_address_country || '')) ids.add(l.id);
          if (p >= (j.pages || 1)) break; p++; await sleep(500);
        }
      }
      c.locs = [...ids]; c.page = 1;
    }
    while (Date.now() - t0 < budget && c.locs.length) {
      // de 40 en 40 tiendas para que la URL no sea enorme
      const chunk = c.locs.slice(0, 40);
      const j = await getJson(`${API}/prices?location_id__in=${chunk.join(',')}&date__gte=${since}&currency=EUR&order_by=-date&size=100&page=${c.page}`);
      const items = (j.items || []).filter((x: any) => x.product_code && x.price && x.product?.product_name);
      // el más reciente de cada código en esta página
      const best = new Map<string, any>();
      for (const x of items) if (!best.has(x.product_code)) best.set(x.product_code, x);
      const codes = [...best.keys()].map(k => 'ean:' + k);
      const { data: have } = codes.length ? await sb.from('c_items').select('ext_id,updated_at').eq('store', store).in('ext_id', codes) : { data: [] };
      const seen = new Map((have || []).map((h: any) => [h.ext_id, new Date(h.updated_at).getTime()]));
      const rows: any[] = [];
      for (const [code, x] of best) {
        const when = new Date(x.date + 'T12:00:00Z').getTime();
        if ((seen.get('ean:' + code) ?? 0) >= when) continue;
        const pr = x.product; const qty = num(pr.product_quantity); const qu = String(pr.product_quantity_unit || '').toLowerCase();
        let net_qty: number | null = null, net_unit: string | null = null;
        if (qty && (qu === 'g' || qu === 'kg')) { net_qty = qu === 'g' ? qty / 1000 : qty; net_unit = 'kg'; }
        if (qty && (qu === 'ml' || qu === 'l' || qu === 'cl')) { net_qty = qu === 'ml' ? qty / 1000 : qu === 'cl' ? qty / 100 : qty; net_unit = 'l'; }
        const per = x.price_per === 'KILOGRAM' ? 'kg' : x.price_per === 'LITRE' ? 'l' : null;
        const price = num(x.price);
        rows.push({
          store, ext_id: 'ean:' + code, url: 'https://prices.openfoodfacts.org/products/' + code,
          name: String(pr.product_name).replace(/\s+/g, ' ').trim().slice(0, 200), brand: pr.brands ? String(pr.brands).split(',')[0].trim() : null,
          image_url: pr.image_url || null, size_label: per ? null : (pr.quantity || (net_qty && net_unit ? fmt(net_qty, net_unit) : null)),
          net_qty: per ? 1 : net_qty, net_unit: per ?? net_unit, price,
          unit_price: per ? price : (price && net_qty ? +(price / net_qty).toFixed(2) : null), unit: per ?? net_unit, loose: !!per,
          old_price: x.price_is_discounted && num(x.price_without_discount) && num(x.price_without_discount)! > price! ? num(x.price_without_discount) : null,
          store_cat: null, store_cat_path: null, active: true, updated_at: new Date(when).toISOString(),
        });
      }
      if (rows.length) {
        const { data: up, error } = await sb.from('c_items').upsert(rows, { onConflict: 'store,ext_id' }).select('id,price,unit_price,updated_at,excluded');
        if (error) { failed += rows.length; msg = error.message; }
        else {
          ok += rows.length;
          const hist = (up || []).filter((x: any) => x.price != null && !x.excluded).map((x: any) => ({ item_id: x.id, price: x.price, unit_price: x.unit_price, seen_on: String(x.updated_at).slice(0, 10) }));
          if (hist.length) await sb.from('c_price_hist').upsert(hist, { onConflict: 'item_id,seen_on', ignoreDuplicates: true });
        }
      }
      if (c.page >= (j.pages || 1)) { c.locs = c.locs.slice(40); c.page = 1; } else c.page++;
      await sleep(700);
    }
  } catch (e) { msg = String(e).slice(0, 300); }
  const finished = Array.isArray(c.locs) && c.locs.length === 0;
  await sb.from('import_runs').update({ cursor: c, items_ok: ok, items_failed: failed, message: msg || null, status: finished ? 'done' : 'running', finished_at: finished ? new Date().toISOString() : null }).eq('id', run.id);
  return J({ ok: true, store, quedan_tiendas: c.locs?.length, page: c.page, productos: ok, fallos: failed, finished, msg });
});
function num(s: any) { if (s == null) return null; const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : null; }
