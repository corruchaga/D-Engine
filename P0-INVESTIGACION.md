# 📋 D-Engine — Informe P0: Investigación y Estado del Arte

> **Propósito de este documento:** contexto base para el desarrollo de D-Engine. Contiene la investigación sobre Aider, DeepSeek Harness (dsh), licencias y las decisiones de arquitectura derivadas. Léelo completo antes de escribir código.

---

## 1. Qué es D-Engine (resumen de identidad)

**D-Engine: la IA piensa, la puerta decide.** Harness CLI standalone en TypeScript donde:
- El LLM (nube) solo propone cambios semánticos (bloques SEARCH/REPLACE).
- El motor local aplica los cambios en una **fotocopia** (git worktree), nunca en el código real.
- Un **compilador local** actúa de puerta: compila → consolida; falla → rollback automático.
- Modo `--verify` opcional: segunda llamada barata al LLM para auditoría semántica del diff.
- Ordenación de contexto optimizada para prompt caching + archivo `DECISIONS.md` persistente.

---

## 2. Lecciones de Aider (el referente del formato SEARCH/REPLACE)

### 2.1. Aider no usa un formato, usa siete (y elige según el modelo)

| Formato | Descripción |
|---|---|
| `diff` | Bloques `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` |
| `diff-fenced` | Igual, pero con la ruta del archivo en la cabecera del bloque de código |
| `udiff` | Diff unificado SIN números de línea (los LLM son pésimos contando líneas) |
| `whole` | Reescritura completa del archivo |
| `patch` | Formato nativo de OpenAI |
| `editor-diff` / `editor-whole` | Variantes internas |

**Lección:** soportar como mínimo `diff` y `diff-fenced` en nuestro parser.

### 2.2. EL HALLAZGO CLAVE: la coincidencia exacta falla 1 de cada 4 veces

Datos reales de acierto del formato SEARCH/REPLACE:
- Coincidencia exacta pura: **~70-75% de éxito**
- Cursor (modelo IA dedicado a aplicar cambios): ~85%
- Benchmark propio de Aider con bloques: ~66%

**Por qué falla:** el LLM reproduce el bloque SEARCH con un espacio de más, indentación distinta, o líneas que cambiaron desde que lo leyó.

### 2.3. La solución de Aider: cascada de 4 estrategias de búsqueda

Aider NO aplica un simple `.includes()`. Aplica en cascada:

1. **Coincidencia exacta**
2. **Normalizando saltos de línea** (`\r\n` → `\n`)
3. **Ignorando espacios en blanco al final de línea**
4. **Coincidencia difusa** (fuzzy matching por similitud de líneas, umbral ~0.85)

Si todo falla → error detallado al LLM → reintento de solo ese bloque.

**⚠️ OBLIGATORIO en D-Engine:** nuestro `LocalEditor` debe implementar la cascada completa, no solo la estrategia 1. Esto es la diferencia entre juguete y herramienta profesional.

### 2.4. Regla de formato por tamaño de archivo

Los benchmarks académicos (2025-2026) confirman:
- Archivos **<300 tokens (~1200 caracteres)**: reescritura completa es más barata y fiable que SEARCH/REPLACE.
- Archivos grandes: SEARCH/REPLACE con contexto anclado gana a diffs con números de línea.

**Regla en D-Engine:** el motor decide el formato según el tamaño del archivo objetivo.

---

## 3. Lecciones de DeepSeek Harness (dsh) — el patrón de arquitectura

### 3.1. Pipeline de ejecución por capas (hooks)

dsh ejecuta herramientas en cascadas de hooks:

```
tools/pre-execute  → políticas, aprobación, permisos
guards             → verificaciones (ej: leer antes de editar)
tools/execute      → la herramienta real
tools/post-execute → reescritura del resultado
tools/result       → observación final
```

**Lección:** las decisiones de seguridad NO van dentro de las herramientas, van en **capas alrededor**. En D-Engine, la fotocopia, la puerta de compilación y el `--verify` son capas independientes del pipeline, activables por separado. Diseñar como pipeline de capas, NO como script monolítico.

### 3.2. Modelo agnóstico

En dsh el modelo es un plugin intercambiable por configuración. En D-Engine: `LLMClient` con adaptador OpenAI-compatible (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) que sirva para DeepSeek, OpenRouter, Gemini u Ollama local. Nada de acoplar el código a un proveedor.

---

## 4. Licencias (comercialización futura sin problemas)

| Pieza | Licencia | ¿Uso comercial? |
|---|---|---|
| Aider | Apache-2.0 | ✅ Sí (mantener aviso de copyright si copias fragmentos) |
| DeepSeek Harness | MIT | ✅ Sí |
| execa | MIT | ✅ |
| @clack/prompts | MIT | ✅ |
| picocolors | ISC | ✅ |
| tree-sitter | MIT | ✅ |

Todo el stack es permisivo. Aprender de su arquitectura y reimplementar con código propio: 100% legal.

---

## 5. Stack final de D-Engine

| Componente | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript / Node.js | Ecosistema y terreno conocido |
| TUI | @clack/prompts + picocolors | Interfaz elegante con mínimo código |
| Procesos | execa | child_process robusto |
| Aislamiento | git worktree nativo | Fotocopia instantánea sin duplicar disco |
| Parser de bloques | Propio, cascada de 4 estrategias | El corazón del diferencial |
| Validación | tsc --noEmit (configurable a npm test / linter) | Puerta determinista |
| Modelos | Adaptador OpenAI-compatible | Agnóstico |
| Repo-map (Fase futura) | tree-sitter | Índice del proyecto cuando supere la ventana |

---

## 6. Decisiones de arquitectura registradas

1. **Standalone, no plugin.** Proyecto propio con nombre propio. Código abierto (MIT).
2. **Cascada de 4 estrategias** en el editor local (lección Aider, P0).
3. **Formato por tamaño:** <1200 caracteres → reescritura entera; resto → SEARCH/REPLACE anclado.
4. **Pipeline por capas:** sombra → compilación → auditoría opcional → consolidación.
5. **Stateless AI:** cada tarea recibe el estado real del disco, sin historial acumulado.
6. **DECISIONS.md:** archivo de decisiones (el "porqué") inyectado siempre al inicio del contexto.
7. **Ordenación de contexto:** archivos estables primero, volátiles al final (maximiza prompt caching por prefijos).
8. **Banco de pruebas:** bugs reales del historial de TradingPOT para el benchmark final.

---

*Informe generado el 2026-09-09. Fuentes: documentación y repositorios oficiales de Aider (Apache-2.0), DeepSeek Harness (MIT), issues de GitHub sobre fallos de aplicación de SEARCH/REPLACE, y benchmarks académicos 2025-2026 sobre formatos de edición con LLM.*
