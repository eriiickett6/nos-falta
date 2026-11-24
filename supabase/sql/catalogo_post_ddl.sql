-- Proyecto nos-falta-catalogo (xmkwfrfxyvwhpbupmrpp): se aplica DESPUÉS de copiar estructura y datos.

-- 0) clave para que las tareas programadas llamen a los lectores (se genera aquí, no sale de la base)
create table if not exists public.import_config(key text primary key, value text not null);
alter table public.import_config enable row level security;
revoke all on public.import_config from anon, authenticated;
insert into public.import_config(key, value) values ('import_token', encode(gen_random_bytes(24), 'hex')) on conflict (key) do nothing;

-- 1) llamar a los lectores de ESTE proyecto
create or replace function ops.call_fn(fn text, body jsonb, timeout_ms integer default 140000) returns bigint
language sql security definer set search_path to 'public', 'extensions' as $f$
  select net.http_post(
    url := 'https://xmkwfrfxyvwhpbupmrpp.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhta3dmcmZ4eXZ3aHBidXBtcnBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1MjExODIsImV4cCI6MjExMTA5NzE4Mn0.PEwKS16tTzRhxG2fC_RZ3dqj0l3lluAver4h40PARac',
      'x-import-token', (select value from public.import_config where key = 'import_token')),
    body := body, timeout_milliseconds := timeout_ms);
$f$;
revoke execute on function ops.call_fn(text, jsonb, integer) from public, anon, authenticated;

-- 2) prioridad sin mirar las listas (eso está en el otro proyecto): la web marca lo que la gente apunta o vigila
create table if not exists public.c_hot(item_id bigint primary key, at timestamptz not null default now());
alter table public.c_hot enable row level security;
revoke all on public.c_hot from anon, authenticated;
create or replace function public.c_mark_hot(p_ids bigint[]) returns void language sql security definer set search_path to 'public' as $f$
  insert into c_hot(item_id) select unnest(p_ids[1:50]) on conflict (item_id) do update set at = now();
$f$;
grant execute on function public.c_mark_hot(bigint[]) to anon, authenticated;

create or replace function public.c_queue_prio() returns trigger language plpgsql set search_path to 'public' as $f$
declare iid bigint; d boolean;
begin
  if tg_op = 'UPDATE' and new.prio is distinct from old.prio then return new; end if;
  if new.status = 'new' and (tg_op = 'INSERT' or old.status is distinct from 'new') then
    select id, (deal is not null or promo_text is not null or old_price is not null) into iid, d from c_items where store = new.store and ext_id = new.ext_id;
    new.prio := case when iid is null then 0
      when exists (select 1 from c_hot where item_id = iid and at > now() - interval '60 days') then 2
      when d then 1 else 0 end;
  end if;
  return new;
end $f$;

-- 3) la tarea de cada minuto (sin lo de la app: las IP de registro viven en el otro proyecto)
create or replace function ops.tick() returns int language plpgsql security definer set search_path = public, extensions as $f$
declare t timestamptz := date_trunc('minute', now()); md int; dw int; r record; n int := 0;
begin
  md := extract(hour from t at time zone 'UTC')::int * 60 + extract(minute from t)::int;
  dw := extract(isodow from t at time zone 'UTC')::int;
  for r in select * from ops.crawl_plan where active and md % every_min = at_min and (dow is null or dow = dw) order by name loop
    begin perform ops.call_fn(r.fn, r.body, r.timeout_ms); n := n + 1;
    exception when others then raise warning 'tick % %', r.name, sqlerrm; end;
  end loop;
  if md % 15 = 0 then
    update c_queue set status = 'new', err = null where store in ('ahorramas','gadis','ametller','dia') and status = 'error' and err like 'canceling statement%' and tries < 3;
  end if;
  if md = 300 and dw <> 7 then
    update c_queue q set status = 'new' from c_items i
     where q.store = 'gadis' and i.store = 'gadis' and i.ext_id = q.ext_id and q.status <> 'new'
       and i.updated_at < current_date and coalesce(i.checked_at, 'epoch') < current_date;
  end if;
  return n;
end $f$;
revoke execute on function ops.tick() from public, anon, authenticated;

-- 4) para la web: precios de hoy de una lista de productos, y referencia para el ahorro al comprar
create or replace function public.c_items_by_ids(p_ids bigint[]) returns table(id bigint, store text, name text, image_url text, size_label text,
  price numeric, unit_price numeric, unit text, loose boolean, deal_old numeric, promo_text text, active boolean, cat_id text)
language sql stable security definer set search_path to 'public' as $f$
  select i.id, i.store, i.name, i.image_url, i.size_label, i.price, i.unit_price, i.unit, i.loose, i.deal_old, i.promo_text, i.active, i.cat_id
  from c_items i where i.id = any(p_ids[1:300]) $f$;
grant execute on function public.c_items_by_ids(bigint[]) to anon, authenticated;

create or replace function public.c_saving_ref(p_item bigint, p_store text, p_stores text[], p_paid numeric, p_qty numeric) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $f$
declare a c_items; q numeric; unit_paid numeric; ref numeric; n int;
begin
  if p_paid is null or p_paid <= 0 then return null; end if;
  select * into a from c_items where id = p_item; if a.id is null then return null; end if;
  q := greatest(coalesce(p_qty, 1), 1); unit_paid := p_paid / q;
  select avg(pr), count(*) into ref, n from (
    select b.store, min(case when a.net_qty > 0 and b.unit_price is not null and b.unit = a.net_unit and not b.loose and not a.loose
                             then b.unit_price * a.net_qty else b.price end) pr
    from c_matches m join c_items b on b.id = m.b
    where m.a = a.id and m.strict and b.active and not b.excluded and b.price is not null
      and b.store <> coalesce(p_store, a.store) and (p_stores is null or b.store = any(p_stores))
    group by b.store) t;
  if coalesce(n, 0) = 0 or ref is null then return jsonb_build_object('saved', 0, 'ref', null, 'n', 0); end if;
  return jsonb_build_object('saved', greatest(round((ref - unit_paid) * q, 2), 0), 'ref', round(ref, 2), 'n', n, 'paid_unit', round(unit_paid, 2));
end $f$;
grant execute on function public.c_saving_ref(bigint, text, text[], numeric, numeric) to anon, authenticated;

-- 5) "comprobado hoy" del detector de categorías (columna que no venía en la copia)
alter table public.c_items add column if not exists checked_at timestamptz;
create or replace function public.scan_apply(p_store text, p_ok bigint[], p_refetch text[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $f$
declare a int; b int;
begin
  update c_items set checked_at = now() where store = p_store and id = any(p_ok);
  get diagnostics a = row_count;
  update c_queue set status = 'new', prio = 3 where store = p_store and ext_id = any(p_refetch) and status <> 'new';
  get diagnostics b = row_count;
  return jsonb_build_object('marcados', a, 'a_releer', b);
end $f$;
revoke execute on function public.scan_apply(text, bigint[], text[]), public.scan_match(text, text[]) from public, anon, authenticated;
grant execute on function public.scan_apply(text, bigint[], text[]), public.scan_match(text, text[]) to service_role;
