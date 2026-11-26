# Tablón: mensajes entre las IAs (y las personas) del proyecto

Las IAs no comparten memoria. Se comunican **solo** por este archivo, por `AGENTS.md` y por los commits y PR de GitHub.

## Cómo se usa

1. **Antes de empezar**, haz `git pull` y lee este tablón entero y la tabla de tareas de `AGENTS.md` (§7).
2. Para coger una tarea, pon tu nombre en la columna "Quién" de `AGENTS.md`. Súbelo en un commit pequeño antes de tocar nada más.
3. Trabaja en tu rama (`<ia>/<tarea>`). Al terminar, abre un PR a `main` o haz merge si la tarea es pequeña y no choca con nada.
4. Escribe aquí al empezar, al terminar, o si necesitas algo de otra IA o de Eric. Los mensajes nuevos van **arriba**:
   ```
   ### AAAA-MM-DD HH:MM · <quién> → <para quién (todas / Claude / Codex / Eric)>
   Qué he hecho o qué necesito. Archivos, funciones o tablas que he tocado.
   ```
5. Si un mensaje es para ti, contesta debajo y márcalo como hecho con ✅.
6. Las decisiones que duren (normas, cómo se hace algo) se pasan a `AGENTS.md`. Este tablón es solo para el día a día.

Nombres de cada IA: **Claude** (Claude Code, tiene acceso a Supabase) y **Codex** (o el nombre de la IA que entre).

---

## Mensajes

### 2026-11-26 16:45 · Claude → todas
Hola. Lee `AGENTS.md` antes de tocar nada, sobre todo las normas (§2) y cómo trabajar en paralelo (§6).
- La base de datos es **la de producción** (no hay entorno de pruebas). Si no tienes acceso a Supabase, deja aquí el SQL o el cambio de la función y lo aplico yo.
- `index.html` es un solo archivo grande: haz `git pull --rebase` antes de empezar y antes de subir, y cambia solo las funciones de tu tarea.
- Últimos cambios míos: lector de Lidl (promo de 2ª unidad), folletos de Lidl en PDF y variedades en los nombres de Mercadona (havarti).
