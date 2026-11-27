// Folletos de Lidl (endpoints.leaflets.schwarz): lee el PDF público del folleto y saca el texto de cada página.
// Sirve para tener el precio de las ofertas antes de que salgan en la web de Lidl.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { getDocumentProxy } from 'npm:unpdf@0.12.1';

const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
const API = 'https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=';


// ---------- Del texto con posiciones a ofertas ----------
type It = { s: string, x: number, y: number, h: number, w: number };
type Line = { s: string, x: number, y: number, h: number, x2: number };
const PRICE = /^\d{1,3}\.\d{2}\*?$/; // "4.25*": el asterisco remite a la letra pequeña
const SIZE = /^(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b/i;
const toNum = (s: string) => Number(s.replace(',', '.'));

function linesOf(items: It[]): Line[] {
  // une los trozos que están en la misma línea y pegados
  const sm = items.filter(i => i.h >= 7.5 && i.h <= 10.6).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Line[] = [];
  for (const i of sm) {
    const l = out.find(l => Math.abs(l.y - i.y) <= 2 && i.x >= l.x2 - 2 && i.x - l.x2 < 10);
    if (l) { l.s += ' ' + i.s; l.x2 = i.x + i.w; } else out.push({ s: i.s, x: i.x, y: i.y, h: i.h, x2: i.x + i.w });
  }
  return out;
}
function blocksOf(lines: Line[]) {
  // columnas de texto: misma x y líneas seguidas
  const cols: Line[][] = [];
  for (const l of [...lines].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const c = cols.find(c => Math.abs(c[0].x - l.x) <= 3 && l.y - c[c.length - 1].y <= 16 && l.y > c[c.length - 1].y);
    if (c) c.push(l); else cols.push([l]);
  }
  return cols.map(ls => {
    const text = ls.map(l => l.s).join(' ');
    const sizeLine = ls.find(l => SIZE.test(l.s));
    const ups = [...text.replace(/(\d),(\d)/g, '$1.$2').matchAll(/(\d+\.\d{2})\s*€\s*\/\s*(kg|l|100\s*g|100\s*ml)/gi)].map(m => ({ v: +m[1], u: m[2].replace(/\s/g, '').toLowerCase() }));
    let qty: number | null = null, qu: string | null = null, sizeLabel: string | null = null;
    if (sizeLine) {
      const m = sizeLine.s.match(SIZE)!; const n = m[1] ? +m[1] : 1; const v = toNum(m[2]); const u = m[3].toLowerCase();
      sizeLabel = m[0];
      if (u === 'kg') { qty = n * v; qu = 'kg'; } else if (u === 'g') { qty = n * v / 1000; qu = 'kg'; }
      else if (u === 'l') { qty = n * v; qu = 'l'; } else if (u === 'ml') { qty = n * v / 1000; qu = 'l'; } else if (u === 'cl') { qty = n * v / 100; qu = 'l'; }
    }
    // precio esperado = tamaño × precio por kilo/litro de oferta (el último que aparece)
    let expected: number | null = null, unitPrice: number | null = null, unit: string | null = null;
    const up = ups[ups.length - 1];
    const perOf = (u: string) => (u === 'kg' || u === 'l' ? 1 : 0.1); // 100 g = 0,1 kg
    // promo de 2ª unidad: "1 ud 19,08 €/kg / 2 uds 14,33 €/kg" (en catalán "1 u. … / 2 u. …").
    // Precio de una = tamaño × €/kg de 1 ud; precio grande (2ª unidad) = 2 × (tamaño × €/kg de 2 uds) − precio de una.
    const multiBlk = ups.length >= 2 && /(^|\s)1\s*(u(d)?\.?|pack|paquet)\s*\d/i.test(text) && /(^|\s|\/)\s*2\s*(u(ds|\.)?|packs?|paquets?)\s*\d/i.test(text);
    if (multiBlk && qty) {
      const [u1, u2] = ups;
      const one = qty / perOf(u1.u) * u1.v, avg = qty / perOf(u2.u) * u2.v;
      expected = +(2 * avg - one).toFixed(2); unitPrice = u1.u.startsWith('100') ? +(u1.v * 10).toFixed(2) : u1.v; unit = qu;
    } else if (up && qty) {
      expected = +(qty / perOf(up.u) * up.v).toFixed(2); unitPrice = up.u.startsWith('100') ? +(up.v * 10).toFixed(2) : up.v; unit = qu;
    }
    const top = ls.filter(l => !sizeLine || l.y < sizeLine.y).filter(l => l.h >= 8.3);
    const brandL = top.filter(l => /^[A-ZÀ-Ý0-9 &'.\-]{3,}$/.test(l.s) && /[A-Z]{3}/.test(l.s));
    const nameL = top.filter(l => !brandL.includes(l));
    const hs = [...new Set(nameL.map(l => l.h))];
    // folleto bilingüe: el castellano va en letra un poco más pequeña
    const es = hs.length > 1 ? nameL.filter(l => l.h === Math.min(...hs)) : nameL;
    return { x: ls[0].x, y0: ls[0].y, y1: ls[ls.length - 1].y, text, size: sizeLabel, qty, qu, expected, unitPrice, unit,
      brand: brandL.map(l => l.s).join(' ') || null, name: nameL.map(l => l.s).join(' '), nameEs: es.map(l => l.s).join(' '), useful: !!(sizeLine || ups.length) && nameL.length > 0 };
  }).filter(b => b.useful);
}
function parsePage(items: It[], vf: string, vt: string) {
  // precio grande (h ≥ 30) y precios pequeños de al lado ("antes" o "1 ud"); algunas páginas usan letra algo menor
  const prices = items.filter(i => PRICE.test(i.s) && i.h >= 30).map(i => ({ ...i, v: parseFloat(i.s), used: false }));
  const olds = items.filter(i => PRICE.test(i.s) && i.h >= 7.5 && i.h < 30).map(i => ({ ...i, v: parseFloat(i.s), used: false }));
  const pcts = items.filter(i => /^-\d{1,2}\s*%$/.test(i.s));
  const plus = items.filter(i => /lidl plus/i.test(i.s) && /amb|con/i.test(i.s));
  const blocks = blocksOf(linesOf(items));
  const d = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  // fechas de la página: "Des del divendres 27/11 fins al 29/11" / "Desde el viernes 27/11 hasta el 29/11"
  const head = items.filter(i => i.h >= 12 && /\d{1,2}\/\d{1,2}/.test(i.s)).map(i => i.s).join(' ');
  const ds = [...head.matchAll(/(\d{1,2})\/(\d{1,2})/g)].map(m => [+m[1], +m[2]]);
  const yr = Number(vf.slice(0, 4));
  const iso = (dm: number[]) => `${yr}-${String(dm[1]).padStart(2, '0')}-${String(dm[0]).padStart(2, '0')}`;
  const from = ds[0] ? iso(ds[0]) : vf, to = ds[1] ? iso(ds[1]) : vt;
  const out: any[] = [];
  const take = (b: any, p: any, how: string) => {
    p.used = true;
    const o = olds.filter(o => !o.used && o.v > p.v && d(o, p) < 170).sort((a, c) => d(a, p) - d(c, p))[0];
    if (o) o.used = true;
    const pc = o ? pcts.sort((a, c) => d(a, o) - d(c, o))[0] : null;
    const lp = plus.find(l => d(l, p) < 130);
    // "2ª ud 1.15 · 1 ud 2.29 · -50% 2ª ud": el precio grande es el de la 2ª unidad y el pequeño ("1 ud") el de una.
    // Entonces el precio es el de una unidad y la promo va aparte (no es un precio de antes).
    // etiquetas: castellano "2ª ud" / "1 ud", catalán "2a u." / "1 u.", packs "2° pack" / "1 pack" (catalán "2n paquet" / "1 paquet")
    const two = items.some(i => /2\s*(?:[ªa°º]|n)\.?\s*(u(d|\.|nitat|nidad)|pack|paquet)/i.test(i.s) && d(i, p) < 200);
    const one = o ? items.some(i => /^1\s*(u(d)?\.?|pack|paquet)$/i.test(i.s) && d(i, o) < 90) : false;
    const multi = !!(o && two && one);
    const mpct = multi ? Math.round((1 - p.v / o!.v) * 100 / 5) * 5 : null;
    out.push({ name: [b.brand, b.name].filter(Boolean).join(' '), name_es: [b.brand, b.nameEs].filter(Boolean).join(' '), brand: b.brand,
      size_label: b.size, net_qty: b.qty, net_unit: b.qu,
      price: multi ? o!.v : p.v, old_price: multi ? null : (o ? o.v : null),
      pct: multi ? null : (pc && o && d(pc, o) < 120 ? Math.abs(parseInt(pc.s)) : null),
      promo_text: multi ? '2ª unidad al ' + mpct + '%' : null,
      unit_price: multi ? (b.qty ? +(o!.v / b.qty).toFixed(2) : null) : b.unitPrice, unit: multi ? (b.qty ? b.qu : null) : b.unit, lidl_plus: !!lp, valid_from: from, valid_to: to, how });
  };
  // 1) emparejados por la cuenta tamaño × precio por kilo
  for (const b of blocks) {
    if (b.expected == null) continue;
    const c = prices.filter(p => !p.used && Math.abs(p.v - b.expected!) <= Math.max(0.04, b.expected! * 0.03) && d(p, { x: b.x, y: b.y1 }) < 420)
      .sort((p, q) => Math.abs(p.v - b.expected!) - Math.abs(q.v - b.expected!) || d(p, { x: b.x, y: b.y1 }) - d(q, { x: b.x, y: b.y1 }))[0];
    if (c) { (b as any).done = true; take(b, c, 'cuenta'); }
  }
  // 2) el resto, por cercanía (el precio va al lado o debajo de su texto)
  for (const b of blocks) {
    if ((b as any).done) continue;
    const c = prices.filter(p => !p.used && p.y >= b.y0 - 30 && p.y <= b.y1 + 160 && p.x >= b.x - 40 && p.x <= b.x + 240)
      .sort((p, q) => d(p, { x: b.x, y: b.y1 }) - d(q, { x: b.x, y: b.y1 }))[0];
    if (c) take(b, c, 'cerca');
  }
  return out;
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('import_config').select('value').eq('key', 'import_token').single();
  if (!cfg || req.headers.get('x-import-token') !== cfg.value) return new Response('forbidden', { status: 403 });
  const b = await req.json().catch(() => ({}));
  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const get = (u: string) => fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });

  if (b.action === 'robots') {
    const out: Record<string, string> = {};
    for (const h of ['https://endpoints.leaflets.schwarz', 'https://assets.leaflets.schwarz', 'https://lidl.leaflets.schwarz']) {
      try { const r = await get(h + '/robots.txt'); out[h] = r.status + ' ' + (await r.text()).slice(0, 600); } catch (e) { out[h] = 'error ' + String(e); }
    }
    return J(out);
  }

  const ingest = async (flyer: string, fromP: number, toP: number) => {
    // lee unas pocas páginas por llamada (el PDF pesa ~20 MB) y guarda cada trozo de texto con su posición
    const f = (await (await get(API + encodeURIComponent(flyer))).json()).flyer;
    const r = await get(f.pdfUrl);
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()));
    const from = Math.max(1, fromP), to = Math.min(pdf.numPages, toP);
    let n = 0;
    for (let p = from; p <= to; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = (tc.items as any[]).filter(it => String(it.str || '').trim()).map(it => ({
        s: String(it.str).trim(), x: Math.round(it.transform[4]), y: Math.round(vp.height - it.transform[5]),
        h: Math.round(Math.abs(it.transform[3]) * 10) / 10, w: Math.round(it.width) }));
      const { error } = await sb.from('c_flyer_pages').upsert({ store: 'lidl', flyer, page: p, valid_from: f.offerStartDate, valid_to: f.offerEndDate,
        region: (f.regions || []).map((x: any) => x.code).join(','), items, text: items.map(i => i.s).join(' '), read_at: new Date().toISOString() }, { onConflict: 'store,flyer,page' });
      if (error) return { error: error.message, page: p };
      page.cleanup(); n++;
    }
    const total = pdf.numPages; await pdf.destroy();
    return { ok: true, pages: total, read: n, from, to };
  };
  const parse = async (flyer: string) => {
    // convierte las páginas guardadas en ofertas (no vuelve a bajar el PDF), las empareja y las aplica al catálogo
    const { data: pages } = await sb.from('c_flyer_pages').select('page,items,valid_from,valid_to').eq('store', 'lidl').eq('flyer', flyer).order('page');
    await sb.from('c_flyer_offers').delete().eq('store', 'lidl').eq('flyer', flyer);
    const rows: any[] = [];
    for (const pg of pages || []) for (const o of parsePage(pg.items, pg.valid_from, pg.valid_to)) rows.push({ store: 'lidl', flyer, page: pg.page, ...o });
    for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from('c_flyer_offers').insert(rows.slice(i, i + 200)); if (error) return { error: error.message }; }
    const { data: m } = await sb.rpc('c_flyer_match', { p_store: 'lidl', p_flyer: flyer });
    const { data: a } = await sb.rpc('c_flyer_apply', { p_store: 'lidl' });
    await sb.from('import_config').upsert({ key: 'fl_parsed_' + flyer, value: new Date().toISOString() }, { onConflict: 'key' });
    return { ok: true, flyer, pages: (pages || []).length, offers: rows.length, by_math: rows.filter(r => r.how === 'cuenta').length, match: m, apply: a };
  };

  if (b.action === 'ingest') return J(await ingest(b.flyer, b.from ?? 1, b.to ?? (b.from ?? 1) + 8));
  if (b.action === 'parse') return J(await parse(b.flyer));

  if (b.action === 'auto') {
    // 1) folletos de alimentación vigentes y de la semana que viene (edición nacional, la que sale sin tienda elegida)
    const r = await get('https://www.lidl.es/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402');
    const html = await r.text();
    const ids = [...new Set([...html.matchAll(/\/l\/folletos\/(folleto-alimentacion-[a-z0-9-]+?)\/ar\/0/g)].map(m => m[1]))];
    for (const flyer of ids) {
      const meta = (await (await get(API + encodeURIComponent(flyer))).json()).flyer;
      if (!meta || meta.offerEndDate < new Date().toISOString().slice(0, 10)) continue;
      const { data: tc } = await sb.from('import_config').select('value').eq('key', 'fl_pages_' + flyer).maybeSingle();
      const { data: have } = await sb.from('c_flyer_pages').select('page').eq('store', 'lidl').eq('flyer', flyer);
      const got = new Set((have || []).map((x: any) => x.page));
      const total = Number(tc?.value || 0);
      const missing = total ? Array.from({ length: total }, (_, k) => k + 1).filter(p => !got.has(p)) : [1];
      // 2) como mucho 9 páginas por llamada para no quedarnos sin memoria; la siguiente llamada sigue
      if (missing.length) {
        const r2: any = await ingest(flyer, missing[0], missing[0] + 8);
        if (r2.pages) await sb.from('import_config').upsert({ key: 'fl_pages_' + flyer, value: String(r2.pages) }, { onConflict: 'key' });
        return J({ flyer, ...r2 });
      }
      const { data: done } = await sb.from('import_config').select('value').eq('key', 'fl_parsed_' + flyer).maybeSingle();
      if (!done) return J(await parse(flyer));
    }
    // 3) nada nuevo: solo activar o retirar las ofertas que empiezan o acaban hoy
    const { data: a } = await sb.rpc('c_flyer_apply', { p_store: 'lidl' });
    return J({ ok: true, folletos: ids, apply: a });
  }

  return J({ error: 'action' });
});
