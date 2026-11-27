-- Proyecto nos-falta-catalogo (xmkwfrfxyvwhpbupmrpp), 26/11/2026
-- 1) Recuento de comparaciones por producto, calculado una vez al día (antes se contaba en cada búsqueda)
create materialized view if not exists public.c_mcount as
  select a as item_id, count(*)::int nm, (count(*) filter (where strict))::int nms from public.c_matches group by a;
create unique index if not exists c_mcount_pk on public.c_mcount(item_id);
-- se refresca en la tarea diaria: select c_refresh(); refresh materialized view concurrently public.c_mcount
-- 2) c_list2 en plpgsql con SQL dinámico: solo añade los filtros que se usan, así usa el índice trigram (yogur: 3,9 s -> 0,05 s)
-- 3) pg_prewarm cada 10 min (ops.calentar) para que las recargas nocturnas no saquen el catálogo de memoria
-- 4) c_items: columnas ean, price_src ('web' | 'openprices'), price_date; openprices action 'fill' para rellenar precios que el súper no publica
-- 26/11 (2): search_groups en plpgsql sobre c_group_stats (vista materializada por grupo), c_offers_cmp pasa a vista
-- materializada (la vista original es c_offers_cmp_live), c_cat_counts para c_tree. Se refrescan cada hora (catalogo-emparejar)
-- y en la tarea diaria. Lectura pública (grant select a anon): las funciones de búsqueda no son security definer.
-- 26/11 (3): búsqueda más precisa. product_groups.kw (palabras extra: pienso/perro/gato/mascota), c_group_stats.nn = nombre + kw.
-- search_groups: la palabra debe empezar una palabra (\m); grupos por nombre primero; grupos que salen por sus productos solo si
-- son de comida (no bebe-mascotas/higiene/limpieza), >= 2 productos y >= 25 % de los del grupo.
-- c_list2: misma regla de palabra; mascotas/higiene/limpieza al final salvo que se busquen; palabra entera (con plural) primero.

-- ===== Folletos de Lidl (PDF semanal) =====
-- c_flyer_pages: texto de cada página con posición (lo guarda la función catalog-folleto, acción ingest)
-- c_flyer_offers: ofertas sacadas del folleto (acción parse) y emparejadas con c_items (c_flyer_match)
-- c_items.fl_price/fl_old/fl_from/fl_to/fl_plus: la oferta de folleto vigente o próxima de cada producto
-- c_flyer_apply(store): copia la oferta a c_items; si la web no tiene precio, usa el del folleto mientras dure (price_src='folleto')
-- c_list2 y c_item devuelven también fl_price, fl_old, fl_from, fl_to, fl_plus
-- crawl_plan 'folletos-lidl' (cada 20 min): acción auto = busca los folletos de alimentación, lee 9 páginas por vez, parsea y aplica

-- 27/11/2026: promos de 2ª unidad en el folleto y emparejado más estricto
-- c_flyer_offers.promo_text, c_items.fl_promo (c_list2 y c_item lo devuelven); c_flyer_apply pone promo_text "2ª unidad al 50% con Lidl Plus"
-- c_kw_ok(a, b): las palabras zero/gran/mini/light/reserva/crianza... tienen que estar en los dos nombres o en ninguno
-- c_flyer_match: tamaño ±10 %, c_kw_ok y precio del folleto ≤ 1,5 × precio web
-- c_items_deal: 'multi' solo si promo_text es 2x1 / "2ª unidad…" / "N por…"; Lidl con oferta con fecha y sin 30 días de historial → se fía del tachado
