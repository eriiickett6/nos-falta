// Catálogo de Mercadona a partir del dataset abierto de datania (Hugging Face, licencia MIT, se actualiza cada semana).
// No consultamos la API de tienda.mercadona.es directamente: su robots.txt la bloquea para robots.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BASE = 'https://huggingface.co/datasets/datania/mercadona-catalog/resolve/main/';
const UA = 'NosFaltaBot/0.1 (proyecto escolar)';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const n = (v: unknown) => { const x = parseFloat(String(v ?? '').trim()); return isFinite(x) ? x : null; };
const fmtQty = (q: number) => String(+q.toFixed(3)).replace('.', ',');
// precio que pagas = unit_price; €/kg o €/l = bulk_price

function toItem(p: any, path: { ids: string[], names: string[] }) {
  const pi = p.price_instructions || {};
  const price = n(pi.unit_price);
  const bulk = n(pi.bulk_price) ?? n(pi.reference_price);
  const ref = String(pi.reference_format || '').toLowerCase();
  const unit = ref === 'kg' || ref === 'l' ? ref : null;
  const sf = String(pi.size_format || '').toLowerCase();
  const size = n(pi.unit_size);
  const loose = !!pi.approx_size || (pi.selling_method != null && Number(pi.selling_method) !== 0);
  let net_qty: number | null = null, net_unit: string | null = null;
  if (size && (sf === 'kg' || sf === 'l')) { net_qty = size; net_unit = sf; }
  else if (size && sf === 'g') { net_qty = size / 1000; net_unit = 'kg'; }
  else if (size && sf === 'ml') { net_qty = size / 1000; net_unit = 'l'; }
  else if (size && (sf === 'ud' || sf === 'u')) { net_qty = size; net_unit = 'ud'; }
  // el total real sale de precio ÷ precio por kilo/litro (unit_size a veces es por unidad del pack y a veces el total)
  const units = pi.is_pack && pi.total_units > 1 ? Number(pi.total_units) : 0;
  if (price && bulk && unit && !loose) {
    const est = price / bulk; // aproximado: el €/kg viene redondeado
    const sz = net_unit === unit ? net_qty : null;
    if (sz && units && Math.abs(units * sz - est) / est < 0.06) net_qty = +(units * sz).toFixed(3);
    else if (sz && Math.abs(sz - est) / est < 0.06) net_qty = sz;
    else net_qty = +est.toFixed(3);
    net_unit = unit;
  }
  let qtxt = '';
  if (net_qty && net_unit && net_unit !== 'ud') {
    const per = units ? net_qty / units : 0;
    qtxt = units && per > 0 ? units + ' x ' + fmtQty(per) + ' ' + net_unit : fmtQty(net_qty) + ' ' + net_unit;
  } else if (size) qtxt = fmtQty(size) + ' ' + (sf || '');
  if (pi.approx_size && qtxt) qtxt = 'aprox. ' + qtxt;
  const label = [units ? null : p.packaging, qtxt].filter(Boolean).join(' ');
  const prev = n(pi.previous_unit_price);
  return {
    store: 'mercadona', ext_id: String(p.id), url: p.share_url || ('https://tienda.mercadona.es/product/' + p.id),
    name: String(p.display_name || '').trim(), brand: null, image_url: p.thumbnail || null,
    size_label: label || null, net_qty, net_unit, pack_n: pi.total_units ?? null,
    price, unit_price: unit ? bulk : null, unit, loose, old_price: prev && price && prev > price ? prev : null, promo_until: null,
    store_cat: path.ids.join('*'), store_cat_path: path.names.join(' > '),
    excluded: false, active: p.published !== false && price != null && !p.unavailable_from,
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const get = (path: string) => fetch(BASE + path, { headers: { 'User-Agent': UA } });

  if (body.action === 'seed') {
    const r = await get('categories.json');
    if (!r.ok) return J({ error: 'HTTP ' + r.status });
    const j = await r.json();
    const rows: any[] = [], cats: any[] = [];
    for (const s of j.results || []) {
      cats.push({ store: 'mercadona', ext: String(s.id), name: s.name, path: s.name });
      for (const c of s.categories || []) {
        cats.push({ store: 'mercadona', ext: s.id + '*' + c.id, name: c.name, path: s.name + ' > ' + c.name });
        rows.push({ store: 'mercadona', ext_id: 'cat:' + c.id, url: BASE + 'categories/' + c.id + '.json', status: 'new' });
      }
    }
    await sb.from('c_store_cats').upsert(cats, { onConflict: 'store,ext', ignoreDuplicates: true });
    // cada semana el dataset cambia: volvemos a poner todas las categorías en cola
    const { error } = await sb.from('c_queue').upsert(rows, { onConflict: 'store,ext_id' });
    return J({ ok: !error, error: error?.message, sections: (j.results || []).length, categories: rows.length });
  }

  if (body.action === 'crawl') {
    const t0 = Date.now();
    const { data: q } = await sb.from('c_queue').select('*').eq('store', 'mercadona').eq('status', 'new').limit(body.n ?? 8);
    const { data: map } = await sb.from('c_store_cats').select('ext,cat_id').eq('store', 'mercadona');
    const catOf = new Map((map || []).map((m: any) => [m.ext, m.cat_id]));
    let saved = 0, bad = 0;
    for (const job of q || []) {
      if (Date.now() - t0 > 100000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url.replace(BASE, ''));
        if (!r.ok) { status = r.status === 404 ? 'gone' : 'error'; err = 'HTTP ' + r.status; }
        else {
          const c = await r.json();
          const items: any[] = [], subs: any[] = [];
          const secId = String(job.ext_id).replace('cat:', '');
          const parent = (map || []).find((m: any) => String(m.ext).endsWith('*' + secId));
          const prefix = parent ? String(parent.ext) : ('?*' + secId);
          const { data: pc } = await sb.from('c_store_cats').select('path').eq('store', 'mercadona').eq('ext', prefix).maybeSingle();
          const ppath = pc?.path || c.name;
          for (const sc of c.categories || []) {
            const ext = prefix + '*' + sc.id;
            subs.push({ store: 'mercadona', ext, name: sc.name, path: ppath + ' > ' + sc.name });
            for (const p of sc.products || []) {
              const it = toItem(p, { ids: ext.split('*'), names: [...ppath.split(' > '), sc.name] });
              if (!it.name) continue;
              let cat = catOf.get(ext) || null;
              if (!cat) cat = catOf.get(prefix) || null;
              items.push({ ...it, cat_id: cat, updated_at: new Date().toISOString() });
            }
          }
          if (subs.length) await sb.from('c_store_cats').upsert(subs, { onConflict: 'store,ext', ignoreDuplicates: true });
          const seen = new Set<string>(); const uniq = items.filter(i => !seen.has(i.ext_id) && seen.add(i.ext_id));
          for (let i = 0; i < uniq.length; i += 200) {
            const { data: rows, error } = await sb.from('c_items').upsert(uniq.slice(i, i + 200), { onConflict: 'store,ext_id' }).select('id,price,unit_price');
            if (error) { bad++; err = error.message; status = 'error'; break; }
            saved += rows!.length;
            const hist = rows!.filter((x: any) => x.price != null).map((x: any) => ({ item_id: x.id, price: x.price, unit_price: x.unit_price }));
            if (hist.length) await sb.from('c_price_hist').upsert(hist, { onConflict: 'item_id,seen_on' });
          }
        }
      } catch (e) { status = 'error'; err = String(e).slice(0, 300); bad++; }
      await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', 'mercadona').eq('ext_id', job.ext_id);
      await sleep(1500);
    }
    return J({ ok: true, picked: (q || []).length, saved, errors: bad, ms: Date.now() - t0 });
  }
  return J({ error: 'action' });
});
