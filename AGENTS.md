# Nos Falta: guía para trabajar en el proyecto (personas e IAs)

Este archivo es la "memoria" del proyecto. Explica cómo está hecho todo, cómo se hace cada tarea y qué normas hay que respetar.
Cualquier IA (Claude, Codex, Cursor, Copilot, etc.) o persona que trabaje aquí debe **leerlo entero antes de tocar nada**.
Si cambias cómo funciona algo, **actualiza este archivo en el mismo commit**.

---

## 1. Qué es

App web (PWA) de lista de la compra compartida para pisos y familias, con precios reales de supermercados españoles.
Proyecto de emprendeduría (iFest · FP Empren) de Aleix, Marc y Eric.

- Web publicada: https://eriiickett6.github.io/nos-falta/ (GitHub Pages, rama `main`, raíz del repo).
- Todo se hace en GitHub. **Wix ya no se usa: no hacer cambios ni darle soporte** (la carpeta `dist/` es de Wix y se puede borrar).
- Idioma: todo en **español** (textos de la app, comentarios del código, commits y respuestas al usuario).

## 2. Normas que no se pueden saltar

1. **Respetar robots.txt** de cada web. Si una web bloquea, se para; nunca se intenta saltar un bloqueo (ni cambiar de IP, ni otro User-Agent, ni proxies).
2. User-Agent siempre identificado: `Mozilla/5.0 (compatible; NosFaltaBot/0.1; proyecto escolar)`. Peticiones en serie y con pausa (≥ 0,4–1,5 s).
3. Si una web responde 202/403/429/503 o un reto anti-bots, el lector para ese súper y no insiste.
4. **No usar la cuenta personal de Mercadona** ni ninguna cuenta del usuario para leer datos.
5. **El email del usuario es privado**: nunca enviarlo a servicios externos ni escribirlo en el repo.
6. **Nada secreto en el repo ni en las páginas.** El token de las funciones (`import_token`) solo vive en la tabla `import_config` de Supabase. Las claves `sb_publishable_…` del `index.html` son públicas a propósito (es correcto).
7. El catálogo solo guarda: **comida, bebida, higiene, limpieza, bebé y mascotas**. El resto (electrónica, ropa, bricolaje, juguetes, deporte, muebles…) se marca `excluded = true`.
8. **SQL destructivo** (`drop`, `delete`, `truncate`, `update` masivo): pensarlo dos veces y avisar al usuario. Supabase le pide confirmación; si no contesta, no se aplica nada.
9. No guardar datos personales de usuarios fuera de Supabase.

## 3. Arquitectura

```
Navegador (index.html, vanilla JS, sin build)
  ├─ sb  → Supabase "app"       jdaheyiupovupwzkmmvl  (casas, listas, gastos, usuarios, zona)
  └─ sbC → Supabase "catálogo"  xmkwfrfxyvwhpbupmrpp  (nos-falta-catalogo: productos y precios de los súpers)

Supabase catálogo
  ├─ Edge functions (Deno) en supabase/functions/*  → leen las webs de los súpers
  ├─ pg_cron: catalogo-tick (cada minuto) → ops.tick() → lee ops.crawl_plan → ops.call_fn(fn, body) con pg_net
  └─ Vistas materializadas para que la búsqueda sea instantánea
```

### Archivos del repo

| Ruta | Qué es |
|---|---|
| `index.html` | Toda la app (HTML + CSS + JS en un solo archivo, sin compilar). |
| `sw.js` | Service worker: guarda la app para abrir sin internet. Sube `V` si cambia la lista de archivos base. |
| `privacidad.html`, `manifest.webmanifest`, `img/` | Página de privacidad, PWA e imágenes. |
| `supabase/functions/<nombre>/index.ts` | Código de cada edge function (copia de lo desplegado). |
| `supabase/sql/*.sql` + `supabase/sql/README.md` | SQL y notas de las funciones de la base de datos. |
| `memoria/` | Material de la memoria del proyecto. |
| `dist/` | Restos de Wix. No usar. |

### Frontend (index.html)

- Vanilla JS. Helper `h(tag, attrs, ...hijos)` para crear nodos; `$()` = querySelector.
- `tfetch`: fetch con timeout de 12 s, usado por los dos clientes de Supabase.
- Cola offline: los cambios de la casa se guardan en el móvil y se envían al volver la conexión.
- Búsqueda: caché `SCACHE` (60 entradas por término + súpers), debounce 180 ms, texto "Añadir «…»" al instante.
- Llamadas al catálogo (`sbC.rpc`): `search_groups`, `c_list2`, `c_list_folleto`, `c_item`, `c_like`, `c_tree`, `c_store_stats`, `c_offers`, `c_drops`, `c_hist`, `compare_groups`, `group_detail`, `compare_citems`, `c_items_by_ids`, `c_mark_hot`, `c_saving_ref`, `home_stats`.
- Llamadas a la app (`sb.rpc`): `near_get`, `near_save`, `hh_watch_list`, `hh_savings`, `product_prices`, `compare_prices`, `catalog_stats` y las `hh_*` de la casa.
- Probar que el JS no tiene errores de sintaxis antes de publicar:
  ```bash
  node -e "const s=require('fs').readFileSync('index.html','utf8');for(const x of s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)){new Function(x[1])}console.log('ok')"
  ```

## 4. Base de datos del catálogo (xmkwfrfxyvwhpbupmrpp)

### Tablas principales

- `c_items`: un producto de un súper (`store`, `ext_id` únicos juntos). Campos clave: `name`, `brand`, `size_label`, `net_qty`, `net_unit` (kg/l/ud), `price`, `unit_price` + `unit`, `old_price`, `promo_text` (2x1, "2ª unidad al 50%", "Con Lidl Plus"…), `promo_until`, `cat_id`, `excluded`, `active`, `ean`, `price_src` (`web` / `openprices` / `folleto`), `price_date`, `fl_*` (oferta del folleto).
  Columnas calculadas: `nname` (nombre normalizado), `deal` (`rebaja` / `multi`), `deal_old`.
- `c_queue`: cola de fichas por leer (`status`: new / done / gone / error, `prio`).
- `c_cats` (árbol común de categorías) y `c_store_cats` (categoría del súper → la nuestra).
- `c_matches`: parejas del mismo producto entre súpers (`strict` = casi idéntico).
- `c_price_hist`: un precio por producto y día (gráfica de historial y bajadas de precio).
- `product_groups` (con `kw` = palabras clave, p. ej. pienso/perro/gato para mascotas).
- `c_flyer_pages`, `c_flyer_offers`: folletos de Lidl (ver §6).
- `import_config`: configuración (clave/valor). Aquí está `import_token` (secreto) y los cursores de las funciones.
- `ops.crawl_plan`: qué función se llama, con qué `body`, cada cuántos minutos (`every_min`, `at_min`), `active`.

### Vistas materializadas (búsqueda rápida)

| Vista | Para qué | Se refresca |
|---|---|---|
| `c_mcount` | nº de parejas de cada producto | diario |
| `c_group_stats` | `search_groups` en < 10 ms | cada hora |
| `c_offers_cmp` | comparador (`compare_groups`, `group_detail`) | cada hora |
| `c_cat_counts` | árbol de categorías (`c_tree`) | cada hora |
| `c_store_stats_mv` | nº de productos de cada súper (`c_store_stats`) | cada hora |
| `c_drops_mv` | bajadas de precio | cada 3 h |

Si creas una vista materializada nueva que lea el navegador: `grant select … to anon, authenticated` (las funciones no son SECURITY DEFINER).

### Cron (pg_cron)

- `catalogo-tick` cada minuto → `ops.tick()` → ejecuta lo que toque de `ops.crawl_plan`.
- `catalogo-emparejar` (:17 cada hora) → `c_refresh_light()` + refresco de vistas.
- `catalogo-emparejar-diario` (01:07) → `c_refresh()` completo + `c_mcount`.
- `bajadas-de-precio` (cada 3 h), `calentar-busqueda` (cada 10 min, `pg_prewarm`).

### Búsqueda: reglas de precisión

- Se busca por palabra entera al principio (`'\m' || término`), no por trozos: "pollo" no encuentra "repollo".
- Primero los resultados donde la palabra está completa (`término(s|es)?\M`).
- Mascotas, higiene y limpieza van al final **salvo** que la búsqueda los pida (pienso, gato, champú, detergente…). Así "pollo" no saca comida de gato.
- `c_list2` usa SQL dinámico (`format` + `EXECUTE … USING`) para que use el índice trigram. No volver a un `where ($1 is null or …)`: era 80 veces más lento.

## 5. Cómo se hace cada cosa

### 5.1 Desplegar una edge function

1. Editar `supabase/functions/<nombre>/index.ts`.
2. Comprobar que compila: `npx -y esbuild supabase/functions/<nombre>/index.ts --format=esm --platform=neutral --outfile=/tmp/x.js`
3. Desplegar en el proyecto **catálogo** (`xmkwfrfxyvwhpbupmrpp`) con `verify_jwt = false` (cada función comprueba ella misma la cabecera `x-import-token` contra `import_config.import_token`).
   - Con la CLI: `supabase functions deploy <nombre> --project-ref xmkwfrfxyvwhpbupmrpp --no-verify-jwt`
   - O con el MCP de Supabase (`deploy_edge_function`).
4. Probarla desde SQL (pg_net, asíncrono):
   ```sql
   select ops.call_fn('<nombre>', '{"action":"..."}'::jsonb, 140000);   -- devuelve un id
   select status_code, left(content, 2000) from net._http_response where id = <id>;  -- tarda 1-2 min en aparecer
   ```
5. Commit del código en el repo (lo desplegado y lo del repo tienen que coincidir).

Límites: ~150 s por llamada y memoria limitada (`WORKER_RESOURCE_LIMIT`). Trocear el trabajo (n productos o páginas por llamada) y guardar el cursor en `import_config` o en `c_queue`.

### 5.2 Programar una tarea periódica

```sql
insert into ops.crawl_plan (name, fn, body, every_min, at_min, active)
values ('nombre-unico', 'catalog-xxx', '{"action":"crawl","n":40}', 2, 0, true);
```
Desactivar: `update ops.crawl_plan set active = false where name = '…';`

### 5.3 Añadir un supermercado nuevo

1. Mirar su `robots.txt` y si tiene sitemap de productos. Si robots.txt bloquea las fichas, **no se hace** (buscar datos abiertos: Open Prices, datasets públicos).
2. Si sus fichas tienen JSON-LD de schema.org, añadirlo a `catalog-web` (configuración por súper). Si no, crear `catalog-<súper>` siguiendo `catalog-dia` como plantilla: acción `seed` (sitemap → `c_queue`) y acción `crawl` (lee n fichas → `c_items` + `c_price_hist`).
3. Mapear sus categorías a `c_cats` (`c_store_cats` o una función `c_<súper>_cat`). Marcar `excluded` lo que no sea comida, bebida, higiene, limpieza, bebé o mascotas.
4. Añadir las filas a `ops.crawl_plan` (seed diario + crawl cada pocos minutos).
5. En `index.html`: nombre, logo y web del súper (`SURL`, `kName`, `slogo`).
6. Al día siguiente, `c_refresh()` lo empareja con los demás.

### 5.4 Promos de varias unidades (2x1, 2ª unidad al 50%…)

- Función `promoOf(texto)` en cada lector: devuelve `2x1`, `3x2`, `2ª unidad al 50%`, `2ª unidad gratis`, `3 por 5,00 €`… o null.
- **Regla de precio**: con una promo de varias unidades, `price` = lo que cuesta **una** unidad (el precio tachado), `old_price` = null y `promo_text` = la promo. Nunca guardar como precio el de la 2ª unidad. La app calcula el precio medio llevando varias (`promoAvg`).
- **Lidl, web (API de cuadrícula)**: el precio completo está en `regionsPrices[*].currentPrice` (tachado, `discount.discountText` = "-50% 2a ud.", fechas). Si la oferta es **solo con Lidl Plus**, está en `regionsPrices[*].currentLidlPlusPrice` (`price` + `highlightText` = "-50% 2a ud."). `x.price` y `x.lidlPlus` son resúmenes que a veces no traen ni el texto ni el tachado: solo de reserva. Si falta el tachado, el precio de una unidad se saca del %. Resultado correcto del jamón Realvalle: `price` 2,29 €, `promo_text` "2ª unidad al 50% con Lidl Plus".
- **Lidl, folleto PDF**: en grande va el precio de la 2ª unidad ("2ª ud 1.15") y en pequeño "1 ud 2.29" (en catalán "2a u." / "1 u."). Eso no es un precio de antes: el precio es el de "1 ud" y la promo va en `promo_text`. La cuenta que lo comprueba: con "1 ud 19,08 €/kg / 2 uds 14,33 €/kg" y 120 g, el precio grande = 2 × 1,72 − 2,29 = 1,15 €.
- Fallos de este tipo los vio Eric a ojo dos veces (26 y 27/11/2026): antes de dar por buena una tienda nueva o un cambio en un lector, comparar a mano 5-10 productos con promo contra su web.

### 5.4b Cuándo una rebaja es "real" (trigger `c_items_deal`)

- `deal = 'multi'` solo si `promo_text` es una promo de varias unidades (2x1, "2ª unidad…", "3 por…"). "Con Lidl Plus" no es multi.
- `deal = 'rebaja'` si el precio tachado es creíble: `c_ref30` (el precio más bajo de los 30 días antes del último cambio, según nuestro `c_price_hist`) es mayor que el precio actual.
- Excepción Lidl: si la oferta tiene fecha de fin (`promo_until`) y nuestro historial tiene menos de 30 días sin otro precio, nos fiamos del tachado de Lidl. Por ley el tachado es el precio más bajo de los 30 días anteriores.
- En otros súpers (Froiz, Ahorramas…) hay cientos de tachados permanentes: ahí no nos fiamos sin historial.

### 5.5 Lidl

- Lista: sitemap `https://www.lidl.es/p/export/ES/es/product_sitemap.xml.gz` (acción `seed`, 4 veces al día).
- Datos: API de cuadrícula `https://www.lidl.es/p/api/gridboxes/ES/es?erpNumbers=id1,id2,…` (20 por petición, 1,2 s de pausa). Acción `grid` de `catalog-lidl`.
- Productos "En tienda" sin precio online: Lidl no da precio. No inventarlo. Si Lidl Plus da precio, se usa con `promo_text = 'Con Lidl Plus'`.
- No existe API de precios por tienda o región: `regionsPrices` hoy trae el mismo precio para toda España.

### 5.6 Folletos de Lidl (PDF)

Función `catalog-folleto`, acción `auto` cada 20 min (`crawl_plan` `folletos-lidl`):
1. Lee la página de folletos de lidl.es y saca los `folleto-alimentacion-…/ar/0` (edición nacional).
2. Metadatos y PDF: `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=<id>` → `pdfUrl`.
3. `ingest`: 9 páginas por llamada con `npm:unpdf`; guarda cada trozo de texto con su posición en `c_flyer_pages`. El total de páginas va en `import_config.fl_pages_<id>`.
4. `parse`: une texto en líneas y bloques, empareja cada bloque con su precio grande, primero por la cuenta tamaño × €/kg = precio (`how = 'cuenta'`) y si no por cercanía (`'cerca'`), y saca el precio tachado, el %, Lidl Plus y las fechas de la página → `c_flyer_offers`.
5. `c_flyer_match`: une cada oferta con su producto. Pide similitud trigram ≥ 0,45, tamaño ±10 %, que coincidan las palabras que cambian el producto (`c_kw_ok`: zero, gran, mini, light, reserva, crianza…) y que el precio del folleto no pase de 1,5 veces el de la web.
   Las promos de 2ª unidad del folleto se guardan en `c_flyer_offers.promo_text` → `c_items.fl_promo`.
6. `c_flyer_apply('lidl')`: copia la oferta a `c_items.fl_*`. Si la web no tiene precio, usa el del folleto mientras dura (`price_src = 'folleto'`) y lo quita al acabar.
La app enseña "Folleto, desde el 27 nov · 1,29 € con Lidl Plus" (`flTxt` en index.html).

El filtro «Ofertas del folleto» aparece en el catálogo de Lidl. `c_list_folleto` selecciona las ofertas vigentes o próximas antes de paginar, también si el producto carece de precio online. La búsqueda y las categorías acotan los resultados, y los criterios de precio y descuento usan el importe del folleto. El importe anunciado se muestra junto a su fecha. Al añadir el producto a la lista se usa el precio online si está disponible. Claude debe aplicar `supabase/sql/catalogo_filtro_folleto.sql` en **catálogo** antes de publicar la app.

### 5.7 Otras fuentes

- **Mercadona**: dataset abierto de datania en Hugging Face (MIT). Su API bloquea robots, así que no se usa.
  Mercadona a veces quita del nombre visible la variedad que sí está en la URL (ej. su havarti se llama "Queso lonchas cremoso de vaca Hacendado"). `withVariety` añade entre paréntesis las variedades de una lista fija (havarti, emmental, gouda…) que salen en la URL y no en el nombre. Para que se encuentre otra variedad, añádela a `VARIEDADES`.
- **Open Prices** (Open Food Facts): `openprices` acción `fill`. Sirve de poco en Lidl (unos 90 precios).
- **Ocado** (Bonpreu/Esclat, Alcampo): páginas de categoría públicas (`catalog-ocado`).
- **Gadis**: `catalog-scan` solo detecta cambios por categoría y nunca escribe precios.

### 5.8 Cambiar la app y publicar

1. Editar `index.html` (o `sw.js` / `privacidad.html`).
2. Probar la sintaxis (comando de §3).
3. `git commit` + `git push` a `main`. GitHub Pages publica en 1–2 minutos.
4. Si cambian los archivos base del service worker, subir `V` en `sw.js`.

## 6. Cómo trabajar varias IAs a la vez

**Las IAs se hablan por `TABLON.md`** (mensajes con fecha, quién y para quién). Léelo al empezar cada sesión.

**Claude supervisa (lo pidió Eric):** al empezar cada sesión, Claude hace `git fetch`, mira las ramas y PR nuevos de Codex u otras IAs, comprueba que no rompen nada (sintaxis, choques con cambios recientes, SQL que haya que aplicar) y deja en el tablón qué ha revisado, qué ha cambiado al juntarlo y qué falta.

1. **Una tarea = una rama**: `git switch -c <ia>/<tarea>` (ej. `codex/filtro-folleto`). Merge a `main` cuando funcione.
2. **Reservar la tarea** en la tabla de §7: poner tu nombre en "Quién" en un commit pequeño antes de empezar.
3. **No tocar a la vez la misma zona.** Zonas que chocan fácilmente:
   - `index.html`: un solo archivo grande. Cambios pequeños y en funciones distintas; hacer `git pull --rebase` antes de empezar y antes de publicar.
   - Una misma edge function: solo una IA a la vez.
   - Funciones SQL compartidas (`c_list2`, `search_groups`, `c_refresh`): una IA a la vez y probar la velocidad (`explain analyze`) antes y después.
4. **Base de datos compartida en vivo**: no hay entorno de pruebas. Probar con `select`, crear objetos nuevos con nombre nuevo y no borrar nada de otro.
5. Toda función, tabla o cron nueva se documenta aquí o en `supabase/sql/README.md`.
6. Commits en español explicando el *porqué*.

## 7. Tareas abiertas

| Tarea | Detalle | Quién |
|---|---|---|
| Filtro "Ofertas del folleto" | Chip en el catálogo de Lidl con `fl_price is not null`, también las que empiezan después | Codex |
| Calidad del folleto | Rechazar parejas con tamaño distinto o precio ×2 frente a la web; saltar no-comida | |
| Precio "Solo en tienda" | Mostrar productos de Lidl sin precio online como "Precio solo en tienda" en vez de ocultarlos | |
| Limpieza SQL (pide confirmación) | Borrar `export_ddl` / `export_rows` (proyecto app), `ops.mudanza*` / `ddl_aplicar` (catálogo), las tablas viejas del catálogo en el proyecto app y la función de pruebas `lidl-debug` | |
| Borrar `dist/` | Restos de Wix | |
| RGPD | Botón "Borrar mi cuenta" | |
| Lista de mejoras | Ver el documento "Nos Falta — lista de mejoras" (fases) | |
| Auditoría de la web | [Informe y propuesta de mejoras](memoria/auditoria-web.md), pendientes de revisión con Claude y Eric | Codex |
