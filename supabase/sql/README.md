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

### Emparejado horario (`catalogo-emparejar` → `c_refresh()`)
- Corre con `set statement_timeout = '15min'` (con los catálogos nuevos tarda ~1-2 min y el límite por defecto de 2 min se quedaba corto).
- Ya no recalcula la categoría de todos los productos de Ahorramas, Gadis, Ametller, Alcampo y Bonpreu cada hora: el trigger `c_items_prep` ya la pone al insertar o al cambiar el nombre. `c_refresh()` solo rellena los que se hayan quedado sin categoría. Si cambias las reglas de `c_web_cat`, recalcula a mano.

### Súpers nuevos (noviembre 2026)
- **Froiz** (Galicia, Asturias, Castilla y León): `catalog-web` kind `froiz`, fichas del sitemap de supermercado.froiz.com (HTML renderizado en servidor). Crons `catalogo-froiz-w1..w3` y `catalogo-froiz-semanal`.
- **HiperDino** (Canarias): `catalog-web` kind `hiperdino`, sin sitemap de productos: se leen sus páginas de categoría (30 productos por página, `?p=N`). Cron `catalogo-hiperdino` y `catalogo-hiperdino-semanal`.
- Revisados y descartados (respetamos sus normas): Consum, BM y Masymas (misma plataforma; los datos solo salen por `/api/`, prohibido en su robots.txt), Carrefour (reto de Cloudflare), Eroski y Caprabo (captcha), El Corte Inglés/Hipercor (Akamai 403), Alcampo y Bonpreu (reto AWS WAF), Alimerka (los productos solo se cargan por una ruta prohibida en su robots.txt).

### Categorías: retoques comunes (`c_fix_cat`)
- Se aplica en el trigger `c_items_prep` y al final de `c_refresh()` a todos los súpers.
- Si la web lo tiene dentro de una sección de congelados → va a Congelados (pizzas, helados, marisco, pescado, carne, verdura o platos, según `c_frozen_cat(nombre)`).
- Además: arroz a Arroz, quesos rallados y de untar a su sitio, cremas de cacao/untables a "Cremas para untar", cápsulas de café a Café y fuet/salchichón a Embutido curado.
- Productos que solo tenían la sección (p. ej. "bebidas" sin subcategoría): `c_fix_cat` les busca subcategoría por el nombre (vinos, kombuchas, bollería, parafarmacia, barritas, semillas o lo que diga `c_kw_cat`).
- `c_kw_cat`: "tableta" de chocolate ya no se confunde con una tablet, los insecticidas de "Casa y jardín" no se excluyen y la "nutrición y deporte" (barritas, batidos) sí entra.
- HiperDino agrupa mucho sus categorías: si el nombre apunta a otra subcategoría de la misma sección, manda el nombre (en `c_items_prep`).
- Los trabajadores de Ahorramas, Ametller y Gadis pasan a cada 15 min (ya tienen todo cargado; así no saturan las llamadas de pg_net).
- `c_fix_cat` también: comida de mascotas que la web deja en una sección genérica va a Gato/Perro/Otros, y los "platos" de congelados que son pizzas o helados pasan a su sitio. HiperDino: lo que no encaja en "Frescos > Cárnicos envasados" va a Carne elaborada.

### Revisión de categorías (21/11/2026)
- **Solo comida, bebida, higiene, limpieza, bebé y mascotas**: `c_nonfood(cat)` marca como excluido todo lo de ropa, bricolaje, jardín, juguetes, papelería, automoción, granja y hogar (menaje, textil, decoración). Se aplica en el trigger `c_items_prep` y al final de `c_refresh()`.
- **El nombre manda** (`c_fix_cat`): si el nombre empieza por el tipo de producto (yogur, pasta de dientes, champú, gel, desodorante, detergente, cerveza, vino, refresco, agua mineral, patatas fritas, arroz, zumo, leche, pizza, fideos orientales, galletas) va a su apartado aunque la web del súper lo tenga mal puesto.
- **Pizzas**: nevera (Pizzas y masas refrigeradas) o congelador (Congelados > Pizzas) según la sección del súper o si el nombre dice congelada/ultracongelada.
- `c_kw_cat`: arreglados falsos positivos ("sabores" ya no es jabón, "perrito" no es perro, "gelatina" no es helado, las cápsulas de vitaminas no son café, "Animals" no es mascota, "limpieza facial" no es limpieza del hogar, "pasta de dientes" no es pasta).
- `c_refresh()` aplica `c_fix_cat` a todos los productos (antes solo a algunas secciones).
- Segunda pasada (21/11): quesos que algunas webs dejan en Leche van a Quesos; fiambres de pavo/pollo (lonchas, chopped, mortadela) van a Charcutería cocida y no a carne fresca (salvo si la web lo tiene en carnicería); tónicos, geles faciales y agua micelar salen de Limpieza; el membrillo sale de Higiene; helados y galletas saladas por el nombre.
