# D-Engine

La IA piensa, la puerta decide

## Que es

CLI determinista de edicion de codigo con LLM. El modelo propone bloques SEARCH/REPLACE; un runtime local los aplica en un git worktree en sombra, comprueba con `tsc --noEmit` y solo fusiona si compila.

Principio: **la IA propone, la puerta determinista decide.** El LLM no escribe en la rama real.

## Benchmark (portada)

Misma tarea, mismo modelo V4.1-Flash, mismo prompt literal:

| Runtime | Tokens | Tiempo |
| --- | --- | --- |
| D-Engine v0.2.2 | 2.552 | ~4s |
| dsh Minimal | 34.600 | 1m04s |
| dsh esfuerzo Apagado | 37.100 | 6s |
| dsh fabrica (thinking Alto) | 107.000 | 28s |

Resultados globales: calidad **48/50** (empate con el mejor agente del benchmark), media **~2.100 tokens/tarea** vs **~93.000** de dsh, tiempo medio **~2,7s** vs **~38s**.

Benchmark completo y reproducible: [docs/benchmark.md](docs/benchmark.md)

## Instalacion y uso

Requisitos: Node.js, git, TypeScript en el repo objetivo (`tsc --noEmit`).

```bash
git clone https://github.com/USUARIO/D-Engine
cd D-Engine
npm install
cp .env.example .env
```

Rellena `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL` en `.env`.

Desarrollo (sin build):

```bash
npm run dev
```

Produccion local:

```bash
npm run build
npm start
```

La TUI pide: descripcion del cambio, archivo objetivo (Enter vacio = selector automatico), modo de seguridad (Fast / Verify / Shadow) y confirmacion. Fast consolida tras aplicar; Verify anade auditoria semantica; Shadow no consolida sin permiso.

`npm run typecheck` equivale a `tsc --noEmit`.

## Limitaciones conocidas

- No crea archivos nuevos.
- El matching fuzzy (umbral 0,85) es el eslabon debil.
- El selector de archivos P9 no es determinista.

## Roadmap v0.3

- Creacion de archivos nuevos
- Reintento con feedback de tsc
- Verify obligatorio si el parche aplica via fuzzy
- Tiempo y tokens en el resumen final

## Licencia

MIT. Copyright (c) 2026 Sergi Corruchaga.
