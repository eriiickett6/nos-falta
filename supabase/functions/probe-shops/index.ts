// Herramienta interna: mira robots.txt / sitemaps de súpers candidatos (solo lectura, una petición por URL).
const UA = 'Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)';
Deno.serve(async (req) => {
  const b = await req.json().catch(() => ({}));
  const urls: string[] = (b.urls || []).slice(0, 40);
  const max = Math.min(+b.max || 1500, 20000);
  const out = await Promise.all(urls.map(async (u) => {
    const t0 = Date.now();
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      const txt = await r.text();
      return { u, s: r.status, final: r.url, ms: Date.now() - t0, ct: r.headers.get('content-type'), srv: r.headers.get('server'), len: txt.length, body: txt.slice(0, max) };
    } catch (e) { return { u, err: String(e).slice(0, 200) }; }
  }));
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
});
