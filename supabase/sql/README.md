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
