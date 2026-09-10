# D-Engine

**La IA piensa, la puerta decide.**

🇬🇧 [English README](README.md)

CLI determinista de edición de código con LLM. El modelo propone bloques `SEARCH/REPLACE`; un runtime local los aplica en un git worktree en sombra, comprueba con `tsc --noEmit` y solo fusiona si compila. El LLM no escribe en la rama real.

📄 **La historia completa (EN):** [The AI thinks, the gate decides — how I made LLM code edits deterministic (42× fewer tokens)](https://dev.to/sergiocorruchaga/the-ai-thinks-the-gate-decides-how-i-made-llm-code-edits-deterministic-and-cut-token-usage-42x-5cbi)

## Por qué

Los bucles agénticos de código pagan los tokens dos veces: cada turno reenvía toda la trayectoria (archivos, resultados de herramientas, razonamiento) al modelo, y los modos "thinking" multiplican tanto los tokens por turno como el número de turnos. D-Engine elimina el bucle para el caso de edición acotada: un prompt, un conjunto de parches, una puerta determinista.

Misma tarea, mismo modelo V4.1-Flash, mismo prompt literal:

| Runtime | Tokens | Tiempo |
| --- | --- | --- |
| D-Engine v0.2.2 | 2.552 | ~4 s |
| dsh Minimal (una sola herramienta shell) | 34.600 | 1m04s |
| dsh, esfuerzo Apagado | 37.100 | 6 s |
| dsh de fábrica (thinking Alto) | 107.000 | 28 s |

La caja de herramientas no es el coste — **el bucle agéntico lo es**.

## Cómo funciona

1. Describes el cambio; un selector automático (P9) elige los archivos objetivo por presupuesto de tokens.
2. El LLM devuelve bloques `SEARCH/REPLACE` — nada más.
3. Una cascada de 4 estrategias los aplica en local: exacta → saltos de línea normalizados → ignorar espacios finales → fuzzy (umbral 0,85).
4. Todo ocurre en un worktree en sombra. `tsc --noEmit` es la única fuente de verdad.
5. Compila → merge. Cualquier otra cosa → tu rama no se toca.

## Benchmark (portada)

10 tareas congeladas, misma familia de modelo, un intento por tarea, metodología completa publicada:

| Métrica | D-Engine | Bucle agéntico (dsh, fábrica) |
| --- | --- | --- |
| Calidad (máx 50) | 48 | 48 |
| Tokens medios por tarea | ~2.100 (acotado) | ~93.000 (rango 32K–214K) |
| Tiempo medio por tarea | ~2,7 s | ~38 s |
| Commits rotos en main | 0 | 1 (Aider, tarea trampa) |

Misma calidad, **14–42× menos tokens**, factura predecible, cero merges rotos. El benchmark completo — prompts congelados, filas anuladas, incidente de alucinación incluido — está en [docs/benchmark.md](docs/benchmark.md).

## Instalación y uso

Requisitos: Node.js, git, TypeScript en el repo objetivo (`tsc --noEmit`).

```bash
git clone https://github.com/corruchaga/D-Engine
cd D-Engine
npm install
cp .env.example .env
```

Rellena `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL` en `.env`.

Desarrollo (sin build):

```bash
npm run dev
```

Producción local:

```bash
npm run build
npm start
```

La TUI pide: descripción del cambio, archivo objetivo (Enter vacío = selector automático), modo de seguridad (Fast / Verify / Shadow) y confirmación. Fast consolida tras aplicar; Verify añade auditoría semántica; Shadow no consolida sin permiso.

`npm run typecheck` equivale a `tsc --noEmit`.

## Limitaciones conocidas

- No crea archivos nuevos (todavía — ver roadmap).
- El matching fuzzy (umbral 0,85) es el eslabón débil.
- El selector de archivos P9 no es determinista.

## Roadmap v0.3

- Creación de archivos nuevos
- Reintento con feedback de tsc
- Verify obligatorio si el parche aplica vía fuzzy
- Tiempo y tokens en el resumen final

## Licencia

MIT. Copyright (c) 2026 Sergi Corruchaga.
