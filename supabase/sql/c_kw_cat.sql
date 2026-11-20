-- Categoría a partir de palabras (castellano y catalán). Sirve para la ruta de categorías de la web
-- del súper ("Alimentación > Aceite y vinagre > ...") y, si no hay ruta, para el nombre del producto.
-- Devuelve '-' cuando es algo que no queremos (electrónica, ropa, juguetes, muebles...).
create or replace function public.c_kw_cat(t text) returns text language sql immutable as $f$
with s as (select ' ' || public.norm_name(coalesce(t,'')) || ' ' x)
select case
 when x ~ '\m(electro|informatic|telefon|smartphone|movil(es)? libre|television|imagen y sonido|so i imatge|videojueg|videojoc|consola|ordenador|portatil|tablet|fotografia|electrodomestic|climatizacion|climatitzacio)' then '-'
 when x ~ '\m(moda|ropa de|ropa y|roba |calzado|calcat|zapat|sabates|textil|lenceria|bisuteria|relojeria|joyeria|complementos de moda)' then '-'
 when x ~ '\m(juguet|joguin|jocs i joguines|deporte|esport|bicicleta|jardin|jardi\M|piscina|bricolaje|bricolatge|ferreteria|automovil|automocio|motor y|libro|llibre|papeleria|papereria|material escolar|mueble|moble|decoracion|decoracio|iluminacion|il.luminacio|menaje|parament|cocina y menaje|ofimatica|maleta|equipaje|camping|regalo|regal )' then '-'
 -- congelados primero
 when x ~ '\m(congelad|congelat)' then case
   when x ~ '\m(helad|gelat|polo|sorbet)' then 'congelados.helados'
   when x ~ '\mpizza' then 'congelados.pizza'
   when x ~ '\m(marisc|gamba|langostin|llagosti|calamar|pulpo|pop |sepia|mejillon|musclo)' then 'congelados.marisco'
   when x ~ '\m(pescad|peix|merluza|lluc|bacalao|bacalla|salmon|salmo)' then 'congelados.pescado'
   when x ~ '\m(verdura|hortaliz|hortalis|patata|fruta|fruita)' then 'congelados.verdura'
   when x ~ '\m(carne|carn |pollo|pollastre|hamburgues|nugget|croquet)' then 'congelados.carne'
   else 'congelados.platos' end
 when x ~ '\m(helado|gelat|tarrina de helado)' then 'congelados.helados'
 -- bebé y mascotas
 when x ~ '\m(panal|bolquer|toallitas? de bebe|tovalloletes)' then 'bebe.panales'
 when x ~ '\m(bebe|nado|nadons|infantil)\M' and x ~ '\m(higiene|champu|xampu|gel|colonia|crema|cuidado|cura)' then 'bebe.higiene'
 when x ~ '\m(alimentacion infantil|alimentacio infantil|potito|papilla|farinetes|leche infantil|llet infantil|leches de continuacion|bebe|nado|nadons)\M' then 'bebe.alimentacion'
 when x ~ '\m(perro|gos |gossos)' then 'mascotas.perro'
 when x ~ '\m(gato|gat |gats )' then 'mascotas.gato'
 when x ~ '\m(mascota|animal|pajaro|ocell|roedor|rosegador|peces|acuario)' then 'mascotas.otros'
 -- limpieza
 when x ~ '\m(detergent|suavizante|suavitzant|quitamanchas|llevataques|cuidado de la ropa|cura de la roba|rentat de roba|lavado de ropa)' then 'limpieza.ropa'
 when x ~ '\m(lavavajillas|rentavaixelles|rentaplats|friegaplatos)' then 'limpieza.lavavajillas'
 when x ~ '\m(papel higienico|paper higienic|celulosa|servilleta|tovallo|rollo de cocina|paper de cuina|panuelo|mocador)' then 'limpieza.papel'
 when x ~ '\m(bolsas? de basura|bosses d.escombraries|film transparente|paper d.alumini|papel de aluminio|papel de horno)' then 'limpieza.bolsas'
 when x ~ '\m(insectic|antimosquit|antimosquits)' then 'limpieza.insecticidas'
 when x ~ '\m(ambientador|ambientadors)' then 'limpieza.ambientadores'
 when x ~ '\m(estropajo|fregall|bayeta|baieta|fregona|pal de fregar|escoba|escombra|guantes? de|recogedor)' then 'limpieza.utensilios'
 when x ~ '\m(limpi|lejia|lleixiu|neteja|desinfect|friegasuelos|abrillantador)' then 'limpieza.limpiadores'
 -- higiene
 when x ~ '\m(champu|xampu|acondicionador|condicionador|mascarilla capilar|tinte|tint |cabello|cabell|fijador|laca)' then 'higiene.cabello'
 when x ~ '\m(desodorant)' then 'higiene.desodorante'
 when x ~ '\m(dental|dentifric|bucal|cepillo de dientes|raspall de dents|colutori|enjuague)' then 'higiene.bucal'
 when x ~ '\m(afeitad|afaitat|maquinilla|depila|cuchilla|fulla d.afaitar)' then 'higiene.afeitado'
 when x ~ '\m(compresa|tampon|salvaslip|intima|intim )' then 'higiene.intima'
 when x ~ '\m(solar|bronceador|autobronceador|aftersun|after sun)' then 'higiene.solar'
 when x ~ '\m(parafarmacia|botiquin|farmaciola|tiritas|apositos|preservativ)' then 'higiene.parafarmacia'
 when x ~ '\m(perfum|colonia|maquillaje|maquillatge|cosmetic|esmalte|pintalabios)' then 'higiene.cosmetica'
 when x ~ '\m(higiene|gel de bany|gel de ducha|jabon|sabo|corporal|facial|crema hidrat|cuidado personal|cura personal|bastoncillos)' then 'higiene.cuerpo'
 -- desayuno y dulces
 when x ~ '\m(cafe|cafes|capsulas)\M' then 'desayuno.cafe'
 when x ~ '\m(infusion|infusio|te verde|te negre|te negro|manzanilla|camamilla|tila)' then 'desayuno.infusiones'
 when x ~ '\m(cacao|cacau|soluble)' then 'desayuno.cacao'
 when x ~ '\m(mermelad|melmelad|confitura|miel|mel )' then 'desayuno.mermelada'
 when x ~ '\m(crema de cacao|crema de cacau|crema para untar|untable de cacao)' then 'desayuno.untables'
 when x ~ '\m(cereal|muesli|granola|corn flakes)' then 'desayuno.cereales'
 when x ~ '\m(barrita|barreta|tortita|galeta d.arros)' then 'desayuno.barritas'
 when x ~ '\m(galleta|galeta)' then 'desayuno.galletas'
 when x ~ '\m(turron|torro|polvoron|mantecado|neules|panettone)' then 'snacks.navidad'
 when x ~ '\m(chocolate|xocolata|bombon|bombo )' then 'snacks.chocolate'
 when x ~ '\m(golosina|caramel|chicle|xiclet|llaminad|gominola)' then 'snacks.golosinas'
 when x ~ '\m(frutos secos|fruits secs|almendra|ametlla|nueces|nous |pistacho|festuc|cacahuete|cacauet|anacard)' then 'snacks.frutos-secos'
 when x ~ '\m(aceituna|oliva negra|olives|encurtid|envinagrat|pepinillo|cogombret|banderilla)' then 'snacks.aceitunas'
 when x ~ '\m(patatas fritas|patates fregides|xips|snack|aperitivo|aperitiu|palomitas|crispetes|nachos)' then 'snacks.patatas'
 -- bebidas
 when x ~ '\m(cerveza|cervesa)' then 'alcohol.cerveza'
 when x ~ '\m(cava|espumos|champan|xampany)' then 'alcohol.espumosos'
 when x ~ '\m(sidra|sidra|sangria|tinto de verano|tinto de estiu)' then 'alcohol.sidra'
 when x ~ '\m(vino blanco|vi blanc|rosado|vi rosat|vinos blancos|vins blancs)' then 'alcohol.vino-blanco'
 when x ~ '\m(vino|vi negre|vins|bodega|celler)\M' then 'alcohol.vino-tinto'
 when x ~ '\m(licor|whisky|ginebra|gin |ron |vodka|brandy|vermut|anis|orujo|tequila)' then 'alcohol.licores'
 when x ~ '\m(agua|aigua)\M' and x !~ '\m(agua de colonia|aigua de colonia|agua micelar|agua oxigenada|aigua oxigenada|agua fresca)' then 'bebidas.agua'
 when x ~ '\m(isotonic|energetic)' then 'bebidas.energeticas'
 when x ~ '\m(zumo|suc |sucs |nectar|smoothie|batido de fruta)' then 'bebidas.zumos'
 when x ~ '\m(refresc|cola |gaseosa|tonica|limonada|horchata|orxata|te frio|te fred)' then 'bebidas.refrescos'
 when x ~ '\m(batido|batut)' then 'desayuno.batidos'
 -- lácteos y quesos
 when x ~ '\m(bebida vegetal|beguda vegetal|bebidas vegetales|begudes vegetals|bebida de (avena|soja|almendra|arroz))' then 'lacteos.vegetal'
 when x ~ '\m(yogur|iogurt|kefir|bifidus)' then 'lacteos.yogur'
 when x ~ '\m(mantequilla|mantega|margarina|nata|crema de llet)' then 'lacteos.mantequilla'
 when x ~ '\m(natillas|flan|postre|postres|cuajada|mato|arroz con leche|arros amb llet|mousse|gelatina)' then 'lacteos.postres'
 when x ~ '\m(huevo|ou |ous )' then 'lacteos.huevos'
 when x ~ '\m(leche|llet)\M' then 'lacteos.leche'
 when x ~ '\m(queso|formatge)' then case
   when x ~ '\m(loncha|llesca|lonchas|llesques|sandwich)' then 'quesos.lonchas'
   when x ~ '\m(rallad|ratllat)' then 'quesos.rallado'
   when x ~ '\m(untar|fundid|crema|porciones|porcions)' then 'quesos.untar'
   when x ~ '\m(fresc|burgos|mozzarella|ricotta|blando|tou )' then 'quesos.fresco'
   else 'quesos.curado' end
 -- charcutería antes que carne
 when x ~ '\m(pate|pates|sobrasada|foie)\M' then 'charcuteria.pates'
 when x ~ '\m(salchicha|frankfurt|bacon|baco |viena)' then 'charcuteria.salchichas'
 when x ~ '\m(jamon cocido|pernil cuit|pechuga de pavo|pit de gall dindi|fiambre|mortadela|chopped|york)' then 'charcuteria.cocidos'
 when x ~ '\m(jamon|pernil|chorizo|xoric|fuet|salchichon|llonganissa|lomo embuchado|llom embotit|embutido|embotit|charcuteria|xarcuteria|curados)' then 'charcuteria.curados'
 -- carne y pescado
 when x ~ '\m(picada|picat|hamburgues|albondiga|mandonguilla)' then 'carne.picada'
 when x ~ '\m(empanad|arrebossat|marinad|adobad|elaborad)' and x ~ '\m(carne|carn |pollo|pollastre|cerdo|porc)' then 'carne.elaborados'
 when x ~ '\m(pollo|pollastre|pavo|gall dindi|aves|aviram)' then 'carne.pollo'
 when x ~ '\m(cerdo|porc )' then 'carne.cerdo'
 when x ~ '\m(ternera|vedella|vacuno|boví|bovi |buey|bou )' then 'carne.vacuno'
 when x ~ '\m(cordero|xai |conejo|conill|cabrito)' then 'carne.cordero'
 when x ~ '\m(carne|carn |carnisseria|carniceria)' then 'carne.elaborados'
 when x ~ '\m(ahumad|fumat|salazon|salaons|anchoa|anxova)' then 'pescado.ahumado'
 when x ~ '\m(surimi|gula)' then 'pescado.surimi'
 when x ~ '\m(conserva|conserves)' and x ~ '\m(pescad|peix|atun|tonyina|sardin|mejillon|musclo|berberech|escopinya|caballa|verat|bonito)' then 'despensa.conservas-pesc'
 when x ~ '\m(atun|tonyina|sardinilla|berberech|mejillones en|musclos en)' then 'despensa.conservas-pesc'
 when x ~ '\m(marisc|gamba|langostin|llagosti|almeja|cloissa|navaja|navalla)' then 'pescado.marisco'
 when x ~ '\m(pescad|peix|pescateria|peixateria|merluza|lluc|salmon|salmo |bacalao|bacalla|dorada|orada|lubina|llobarro)' then 'pescado.fresco'
 -- fruta y verdura
 when x ~ '\m(ensalada|amanida|lechuga|enciam|canonigo|rucula)' then 'fruta-verdura.ensalada'
 when x ~ '\m(seta|bolet|champinon|xampinyo|hierbas aromat|herbes aromat)' then 'fruta-verdura.otros'
 when x ~ '\m(conserva|conserves)' then 'despensa.conservas-veg'
 when x ~ '\m(fruta|fruita|platano|platan|manzana|poma |naranja|taronja|pera |fresa|maduixa|uva |raim|melon|sandia|kiwi|mandarina|limon|llimona|aguacate|alvocat)' then 'fruta-verdura.fruta'
 when x ~ '\m(verdura|hortaliz|hortalis|tomate|tomaquet|patata|cebolla|ceba |zanahoria|pastanaga|pimiento|pebrot|calabac|carbasso|ajo |all |berenjena|alberginia|brocoli|coliflor|pepino|cogombre)' then 'fruta-verdura.verdura'
 -- despensa
 when x ~ '\m(aceite|oli |olis )' then 'despensa.aceite'
 when x ~ '\m(vinagre)' then 'despensa.aceite'
 when x ~ '\m(arroz|arros)\M' then 'despensa.arroz'
 when x ~ '\m(legumbre|llegum|garbanzo|cigro|lenteja|llentia|alubia|mongeta|judia)' then 'despensa.legumbres'
 when x ~ '\m(pasta fresca|pasta farcida|pasta rellena|tortellini|ravioli)' then 'preparados.pasta-fresca'
 when x ~ '\m(pasta|macarron|espagueti|fideo|fideu|tallarin|lasana|canelon)' then 'despensa.pasta'
 when x ~ '\m(harina|farina|levadura|llevat|reposteria|rebosteria|pan rallado)' then 'despensa.harina'
 when x ~ '\m(azucar|sucre|edulcorant|sacarina)' then 'despensa.azucar'
 when x ~ '\m(caldo|brou|sopa|crema de verdura|pure )' then 'despensa.caldos'
 when x ~ '\m(tomate frito|tomaquet fregit|salsa|ketchup|mayonesa|maionesa|mostaza|mostassa|alioli)' then 'despensa.salsas'
 when x ~ '\m(sal |especia|especies|condiment|pimienta|pebre|oregano|canela|curry|pimenton)' then 'despensa.especias'
 -- panadería y preparados
 when x ~ '\m(tostad|torrat|picos|biscote|regana|colin|crackers?)' then 'panaderia.tostado'
 when x ~ '\m(pan de molde|pa de motlle|pan de hamburguesa|pan de perrito|tortilla de trigo|wrap)' then 'panaderia.molde'
 when x ~ '\m(bolleria|brioixeria|pasteleria|pastisseria|croissant|magdalena|donut|ensaimada|bizcocho|pastis)' then 'panaderia.bolleria'
 when x ~ '\m(pan|pa|barra|baguette|panaderia|forn|fleca)\M' then 'panaderia.pan'
 when x ~ '\m(hummus|guacamole|dip )' then 'preparados.salsas-frescas'
 when x ~ '\m(pizza|masa de|massa de)' then 'preparados.pizza'
 when x ~ '\m(vegano|vega |vegetariano|vegetaria|tofu|seitan|tempeh)' then 'preparados.veggie'
 when x ~ '\m(plato preparado|plats preparats|platos cocinados|cuinats|listo para|tortilla de patata|truita de patates|gazpacho|salmorejo|sandwich|empanada)' then 'preparados.listo'
 else null end
from s $f$;

create or replace function public.c_web_cat(p text, nm text) returns text language sql immutable as $f$
  -- primero la ruta de categorías de la web; si no dice nada, el nombre
  select case when public.c_kw_cat(p) is not null then public.c_kw_cat(p)
              else coalesce(public.c_kw_cat(nm), '-') end
$f$;
