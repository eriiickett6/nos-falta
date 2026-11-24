// Detector de cambios de precio por páginas de categoría (de momento, Gadis).
// SEGURIDAD: esta función NUNCA escribe datos de producto (ni precio, ni nombre, ni ofertas).
//  - Si el precio de la categoría es igual al guardado y no hay nada de oferta → solo anota checked_at (comprobado hoy).
//  - Si cambia algo, hay promo/oferta, el nombre es ambiguo o hay cualquier duda → pone la ficha en la cola para que
//    la relea el lector de fichas de siempre (catalog-web), que es el único que guarda datos.
// Las páginas de categoría están en el sitemap de categorías y robots.txt las permite (solo prohíbe filtros ?bra= ?q= & ...).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const CFG: Record<string, { catmap: string, base: string }> = {
  gadis: { catmap: 'https://www.gadisline.com/sitemaps/sitemap_categorias.xml', base: 'https://www.gadisline.com' },
};
const PROMO_KEY = /promo|offer|oferta|discount|descuento|before|previous|old_|crossed|tachad|strike/i;

// lee un array/objeto JSON que empieza en "start" (cuenta corchetes y llaves respetando cadenas)
function jsonAt(s: string, start: number): any {
  let d = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') { d--; if (d === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
const esName = (x: any) => { const a = Array.isArray(x) ? x : []; const e = a.find((t: any) => t?.language === 'ES') || a[0]; return e?.value ? String(e.value).replace(/\s+/g, ' ').trim() : null; };
const hasPromo = (p: any) => Object.entries(p).some(([k, v]) => PROMO_KEY.test(k) && v != null && v !== '' && v !== false && v !== 0 && !(Array.isArray(v) && !v.length));

function parseList(html: string) {
  const out: { name: string, price: number, ppk: number | null, promo: boolean, code: string }[] = [];
  let pages = 1;
  const pm = html.match(/"total_pages":(\d+),"total_elements":(\d+)\},"elements":\[/);
  if (pm) pages = +pm[1];
  const seen = new Set<string>();
  for (const m of html.matchAll(/"elements":\[/g)) {
    const arr = jsonAt(html, m.index! + m[0].length - 1);
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== 'object' || p.product_code == null || p.price == null) continue;
      const name = esName(p.commercial_description); if (!name) continue;
      const code = String(p.product_code); if (seen.has(code)) continue; seen.add(code);
      const price = Number(p.price); if (!isFinite(price) || price <= 0) continue;
      out.push({ name, price, ppk: p.price_kilo_litre != null ? Number(p.price_kilo_litre) : null, promo: hasPromo(p), code });
    }
  }
  return { pages, items: out };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: tok } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!tok || req.headers.get('x-import-token') !== tok.value) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const store = String(body.store || ''); const cfg = CFG[store];
  if (!cfg) return J({ error: 'store' });
  const qstore = store + '-scan';
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'es-ES,es;q=0.9' } });

  // 1) mete en la cola todas las páginas de categoría del sitemap
  if (body.action === 'seed') {
    const r = await get(cfg.catmap); if (!r.ok) return J({ error: 'sitemap ' + r.status });
    const xml = await r.text();
    const rows = [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&')))]
      .filter(u => u.startsWith(cfg.base + '/') && !/[?&]/.test(u))
      .map(u => ({ store: qstore, ext_id: u.slice(cfg.base.length), url: u, status: 'new' }));
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('c_queue').upsert(rows.slice(i, i + 1000), { onConflict: 'store,ext_id' });
      if (error) return J({ error: error.message });
    }
    return J({ ok: true, pages: rows.length });
  }

  // 2) lee páginas de categoría y compara con lo guardado. dry=true: no toca nada, solo cuenta.
  if (body.action === 'scan') {
    const t0 = Date.now(); const dry = !!body.dry; const pause = body.pause ?? 1200;
    let qq = sb.from('c_queue').select('*').eq('store', qstore).eq('status', 'new');
    if (body.urls) qq = sb.from('c_queue').select('*').eq('store', qstore).in('ext_id', body.urls);
    const { data: q } = await qq.limit(body.n ?? 30);
    const st = { pages: 0, multipage: 0, elements: 0, same: 0, changed: 0, promo: 0, ambiguous: 0, unmatched: 0, errors: 0, blocked: false, examples: [] as any[], nomatch: [] as string[] };
    for (const job of q || []) {
      if (Date.now() - t0 > 100000) break;
      let status = 'done', err: string | null = null;
      try {
        const r = await get(job.url);
        if (r.status === 404 || r.status === 410) status = 'gone';
        else if (r.status !== 200) { status = 'error'; err = 'HTTP ' + r.status; if ([202, 403, 429, 503].includes(r.status)) st.blocked = true; }
        else {
          const { pages, items } = parseList(await r.text());
          st.pages++; if (pages > 1) st.multipage++; st.elements += items.length;
          if (items.length) {
            // se busca por nombre con una función de la base (los nombres van en el cuerpo, no en la URL); si falla, no se marca nada
            const names = [...new Set(items.map(x => x.name))];
            const { data: found, error: qe } = await sb.rpc('scan_match', { p_store: store, p_names: names });
            if (qe) { st.errors++; status = 'error'; err = 'consulta: ' + qe.message.slice(0, 200); throw new Error('consulta'); }
            const rows: any[] = found || [];
            const byName = new Map<string, any[]>();
            for (const x of rows) { const k = x.name; byName.set(k, [...(byName.get(k) || []), x]); }
            const ok: number[] = []; const refetch: string[] = [];
            for (const it of items) {
              const m = byName.get(it.name) || [];
              if (m.length === 0) { st.unmatched++; if (st.nomatch.length < 5) st.nomatch.push(it.name); continue; }           // producto nuevo: lo añadirá el sitemap de fichas
              if (m.length > 1) { st.ambiguous++; refetch.push(...m.map(x => x.ext_id)); continue; }
              const d = m[0];
              const same = d.price != null && Math.abs(Number(d.price) - it.price) < 0.005;
              const clean = !it.promo && d.old_price == null && d.promo_text == null && d.deal == null && !d.loose;
              if (same && clean) { st.same++; ok.push(d.id); }
              else {
                if (it.promo || !clean) st.promo++; else st.changed++;
                refetch.push(d.ext_id);
                if (st.examples.length < 8) st.examples.push({ name: it.name, web: it.price, guardado: d.price, promo: it.promo || !clean });
              }
            }
            if (!dry) {
              const { error: ae } = await sb.rpc('scan_apply', { p_store: store, p_ok: ok, p_refetch: refetch });
              if (ae) { st.errors++; status = 'error'; err = 'aplicar: ' + ae.message.slice(0, 200); }
            }
          }
        }
      } catch (e) { if (!String(err || '').startsWith('consulta')) { status = 'error'; err = String(e).slice(0, 300); st.errors++; } }
      if (!dry) await sb.from('c_queue').update({ status, err, last_at: new Date().toISOString(), tries: status === 'error' ? job.tries + 1 : 0 }).eq('store', qstore).eq('ext_id', job.ext_id);
      if (st.blocked) break; // si la web nos frena, paramos
      await sleep(pause);
    }
    return J({ ok: true, dry, picked: (q || []).length, ms: Date.now() - t0, ...st });
  }
  return J({ error: 'action' });
});
