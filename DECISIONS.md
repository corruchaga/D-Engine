\# DECISIONS.md — Decisiones de arquitectura de D-Engine



1\. El LLM NUNCA edita archivos directamente. Solo propone bloques SEARCH/REPLACE (editar) o NEW FILE (crear).

2\. Todo cambio se aplica primero en una fotocopia (git worktree), nunca en la rama real.

3\. La puerta de compilación (tsc --noEmit) es obligatoria: código que no compila jamás se consolida.

4\. El modo Verify añade una auditoría semántica entre compilación y merge.

5\. El motor es stateless: cada tarea lee el estado real del disco. Este archivo es la única memoria.

6\. El contexto se ordena estable-primero (DECISIONS.md → archivos estables → archivo objetivo) para maximizar cache hits.

7\. SEARCH debe copiarse carácter exacto; la cascada de 4 estrategias (exact, normalize-newlines, ignore-trailing-whitespace, fuzzy 0.85) resuelve los desajustes. NEW FILE solo aplica a rutas que no existen; un NEW FILE sobre un archivo existente se rechaza y se materializa solo en la fotocopia hasta que la puerta compile.

8\. Toda ejecución limpia su fotocopia y rama temporal, falle o consolide.

9\. Enter vacío en archivo objetivo lanza un selector barato; el usuario confirma o edita; el editor nunca elige solo. El selector puede proponer rutas nuevas bajo src/ y la confirmación las etiqueta como NUEVO.

