// Desactivada: se usó solo para revisar robots.txt y sitemaps de súpers candidatos.
Deno.serve(() => new Response(JSON.stringify({ error: 'desactivada' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
