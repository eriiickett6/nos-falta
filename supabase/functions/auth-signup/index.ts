// Alta con email y contraseña.
// De momento la cuenta queda confirmada al crearla (el correo de bienvenida/confirmación llegará más adelante,
// cuando haya un servidor de correo configurado). Límite: 5 altas por hora desde la misma conexión.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return J({ error: 'metodo' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return J({ error: 'email_no_valido' }, 400);
  if (password.length < 8 || password.length > 72) return J({ error: 'pass_corta' }, 400);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconocida';
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await sb.from('signup_log').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', since);
  if ((count ?? 0) >= 5) return J({ error: 'demasiados_intentos' }, 429);
  await sb.from('signup_log').insert({ ip });

  const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const m = (error.message || '').toLowerCase();
    if (m.includes('already') || m.includes('registered') || m.includes('exists')) return J({ error: 'email_ya_existe' }, 409);
    if (m.includes('password')) return J({ error: 'pass_debil' }, 400);
    return J({ error: 'no_se_pudo' }, 500);
  }
  return J({ ok: true });
});
