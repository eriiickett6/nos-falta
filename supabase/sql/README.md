# Funciones SQL del catálogo

Están en la base de datos de Supabase (migraciones `condis_cat_map` y `lidl_cat_map`):

- `c_condis_cat(path)`: coloca las secciones de Condis en el árbol común `c_cats`.
- `c_lidl_cat(path, nombre)`: lo mismo para Lidl, con reglas por nombre porque Lidl a veces pone productos en secciones raras.
- `c_refresh()`: cada hora (cron `catalogo-emparejar`) aplica estas reglas y recalcula las parejas entre súpers.

## Zona de cada casa (código postal)

- `pc_geo`: códigos postales de España con coordenadas (GeoNames, CC BY 4.0), cargados una vez con la función `near` (`{"action":"loadpc"}`).
- `near_get(cp)`: devuelve el punto del código postal y, si ya se consultó, las tiendas cercanas guardadas en `near_cache`.
- `near_save(cp, tiendas)`: guarda las tiendas que el navegador consulta a OpenStreetMap (Overpass bloquea los servidores de Supabase). Valida cadena y distancia.
- `hh_set_zone(...)`: guarda código postal, radio y súpers elegidos. Con el código postal `00000` la casa queda en modo admin y ve todos los súpers.
- `hh_set_item(...)`: marca un producto de la lista como urgente y le pone una nota.
- `c_list2(...)`: catálogo con orden (relevancia, precio, €/kg, descuento) y filtro de ofertas.
- `c_offers(súpers, n)`: mejores ofertas de los súpers de la zona.

## c_like(p_name, p_brand, p_qty, p_stores, p_per)
Busca un producto por nombre en el catálogo de cada súper. Devuelve por súper hasta `p_per` opciones con `kind`:
`igual` (mismo producto, marca y tamaño ±10%), `casi` (mismo producto con otra marca o tamaño) o `parecido`.
Se usa en la ficha de producto y para rellenar los súpers que faltan en la ficha del catálogo.

## c_store_stats()
Productos, ofertas y última actualización de cada súper (selector de súper del Catálogo).

## Dia (catalog-dia)
Fichas de www.dia.es (robots.txt las permite) desde su sitemap: unos 7.500 productos. Cron `catalogo-dia` cada 2 min (40 fichas, 1,2 s entre fichas) y `catalogo-dia-semanal` (lunes) que vuelve a sembrar la cola.
`c_dia_cat(store_cat, name)` pasa la categoría de Dia (`categoria*subcategoria` de la URL) a la nuestra.

## Ametller Origen, Ahorramas y Gadis (catalog-web)
Una sola función lee las fichas públicas de producto (sitemap + JSON-LD de schema.org) de varios súpers. Crons `catalogo-<súper>` cada 2 min y `catalogo-<súper>-semanal` que vuelve a sembrar la cola.
`c_kw_cat(texto)` y `c_web_cat(ruta, nombre)` sacan nuestra categoría de la ruta de categorías de su web (castellano y catalán); lo que no es comida, bebida, higiene, limpieza, bebé o mascotas queda `excluded`.
Alcampo y Bonpreu i Esclat responden con un reto anti-robots (AWS WAF, HTTP 202): no lo saltamos y sus crons están quitados. Carrefour, El Corte Inglés, Eroski, Familia y Supermercados MAS también bloquean; Consum solo da datos por /api/, que su robots.txt prohíbe.

## Cuentas (email y contraseña)
- Alta con la función `auth-signup` (crea la cuenta ya confirmada; el correo de confirmación llegará cuando haya servidor de correo).
- `profiles`: nombre libre + número de 4 cifras (ID tipo «Laura #4821», único por nombre), código postal de casa y si ya vio el tutorial.
- Funciones (solo con sesión): `me_get`, `me_save(nombre, cp)`, `me_tutorial`, `casa_create`, `casa_join(código, miembro_sin_cuenta)`, `casa_invite(código, 'Nombre #1234')`, `invite_answer`, `casa_free_members`.
- `members.user_id` une a cada persona de la casa con su cuenta; quien usaba la app sin cuenta conserva su casa al registrarse.

## Bajadas de precio
`c_drops_mv` (vista materializada, se recalcula cada hora con el cron `bajadas-de-precio`): el precio de hoy es al menos un 3 % más bajo que el precio anterior en ese súper (`c_price_hist`), ese precio anterior duró al menos 3 días (no cuenta un pico de un día) y el precio bajo sigue vigente hoy (si vuelve a subir, sale de la lista en el siguiente recálculo). No usa el «antes» que anuncia el súper. `c_hist(id)` da el historial de 60 días para la ficha. `c_drops(súpers, límite, desde, orden)` y `home_stats(súpers)` (bajadas y ofertas) para Inicio.

## Ahorro real
Al marcar algo como comprado, `hh_toggle_bought` llama a `li_saving`: precio medio de ese mismo producto (o uno casi idéntico, `c_matches.strict`, ajustado por tamaño) en los otros súpers de la zona de la casa, menos lo que se pagó. Se guarda en el gasto (`receipts.raw`: saved, ref, n, paid_unit). Si ningún otro súper lo tiene, no cuenta. `hh_savings(código)` da el total, el del mes y el detalle.
