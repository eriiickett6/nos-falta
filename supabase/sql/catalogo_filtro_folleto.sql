-- Proyecto nos-falta-catalogo. Aplicar antes de publicar la app.
create or replace function public.c_list_folleto(
  p_cat text, p_q text, p_lim integer, p_off integer, p_sort text
) returns jsonb
language sql stable security invoker
set search_path = public
as $f$
  with busqueda as (
    select btrim(regexp_replace(public.norm_name(coalesce(p_q, '')), '[^[:alnum:]]+', ' ', 'g')) as q
  ), ofertas as (
    select i.id, i.store, i.name, i.brand, i.image_url, i.url, i.updated_at,
           i.cat_id, i.size_label, i.net_qty, i.net_unit, i.loose,
           i.price, i.unit_price, i.unit, i.old_price, i.promo_text, i.promo_until,
           i.fl_price, i.fl_old, i.fl_from, i.fl_to, i.fl_plus, i.nname,
           b.q <> '' and i.nname ~ ('\m' || b.q || '(s|es)?\M') as palabra_entera
      from public.c_items i
      cross join busqueda b
     where i.store = 'lidl' and not i.excluded and i.fl_price is not null
       and (i.fl_to is null or i.fl_to >= (current_timestamp at time zone 'Europe/Madrid')::date)
       and (p_cat is null or i.cat_id = p_cat or starts_with(i.cat_id, p_cat || '.'))
       and (b.q = '' or i.nname ~ ('\m' || b.q))
  )
  select jsonb_build_object(
    'total', (select count(*) from ofertas),
    'items', to_jsonb(array(
      select to_jsonb(i) - 'nname' - 'palabra_entera'
                || jsonb_build_object('nm', coalesce(m.nm, 0), 'nms', coalesce(m.nms, 0))
        from ofertas i
        left join public.c_mcount m on m.item_id = i.id
       order by case when p_sort = 'price' then i.fl_price end asc nulls last,
                case when p_sort = 'unit' then
                  case when i.loose then i.fl_price
                       when i.net_unit in ('kg', 'l') and i.net_qty > 0 then i.fl_price / i.net_qty
                  end
                end asc nulls last,
                case when p_sort = 'offer' and i.fl_old > i.fl_price and i.fl_old > 0
                     then 1 - i.fl_price / i.fl_old
                end desc nulls last,
                i.palabra_entera desc nulls last, i.fl_from asc nulls last, i.nname, i.id
       limit greatest(1, least(coalesce(p_lim, 40), 100))
      offset greatest(0, coalesce(p_off, 0))
    ))
  );
$f$;

revoke execute on function public.c_list_folleto(text, text, integer, integer, text) from public;
grant execute on function public.c_list_folleto(text, text, integer, integer, text) to anon, authenticated;
notify pgrst, 'reload schema';
