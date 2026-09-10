# Benchmark D-Engine v0.1 — repo juguete (bench-repo)

**Ronda v0.1**: ejecutada en la era del alias `deepseek-chat` → V4-Flash, non-thinking (agosto–principios de septiembre 2026). **Documento y anexos**: 10 septiembre 2026.

**Modelo (v0.1)**: deepseek-chat (sin razonamiento extendido / low) en TODOS los contendientes

**Contendientes**: OpenCode · Aider · D-Engine Fast · D-Engine Verify · dsh (2ª ronda, 10-sep-2026, V4.1-Flash)

**Reglas**: mismo prompt literal, un intento por contendiente, reset a `benchmark-base` antes de cada combate (`git reset --hard benchmark-base` + `git clean -fd`), motor congelado durante el benchmark

**Prompts**: CONGELADOS en este documento desde el 10-sep-2026 — cada tarea lleva su prompt literal en bloque de código. Toda ejecución futura los copia tal cual. (Ver nota 10: incidente de registro declarado.)

**Base actual**: tag `benchmark-base` → commit `afef8bd` (movido 2 veces por tareas defectuosas, ver incidentes)

---

## T1 — formatDate DD/MM/YYYY en utils.ts

**Prompt literal (canónico — atestiguado: mismo texto en v0.1, dsh 10-sep y control v0.2.2):**

```
En utils.ts, añade una función formatDate que reciba un Date y devuelva DD/MM/YYYY
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2102 | 156 | ~0,0002 | 2,5s | Sí | 5 | No |
| D-Engine Verify | 2103 + 396 | 187 + 1 | ~0,0002 | 4s | Sí (auditoría OK) | 5 (validación TypeError extra) | No |
| OpenCode | ~8898 ctx | — | 0,00 | 10s | Sí | 5 | No |
| Aider | 2.1k | 458 | ~0,0002 | 5s | Sí (auto-commit 8f7b96b) | 5 | Sí: `.gitignore` |
| dsh — V4.1-Flash, thinking ON, esfuerzo Alto (fábrica) | ~107K total (UI web) | — | n/d | 48,9s wall (28s según UI) | Sí | 5 (guarda TypeError + padStart) | No |

*Fila dsh (10-sep-2026): 12 llamadas a herramientas; tokens leídos de la UI web de dsh (stats de sesión, sin desglose in/out); 48,9s medidos con Stopwatch incluyen arranque del proceso. Config headless de fábrica, sin flags.*

## T2 — renombrar TAX_RATE → IVA_RATE (multi-archivo)

**Prompt literal (canónico — congelado 10-sep-2026 según evidencia de ejecución, ver nota 10):**

```
Renombra la constante TAX_RATE a IVA_RATE en todo el proyecto
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast (1º intento, 1 archivo) | — (ver log) | — | — | 2s | **No consolidó** — rechazo seguro (TS2305 en index.ts) | — | No |
| D-Engine Fast (2º intento, 2 archivos) | — (ver log) | — | — | 2,5s | Sí | 5 | No |
| D-Engine Verify | 2849 + 743 | 295 + 1 | ~0,0003 | 4s | Sí (auditoría OK) | 5 | No |
| OpenCode | ~10003 ctx | — | 0,00 | 9s | Sí | 5 | No |
| Aider | — (ver log) | — | — | 4s | **No** — commitó master roto (TS2305) **con aviso** y auto-commit incluido | 2 | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~43,9K total (UI web) | — | n/d | 19,0s wall (9s según UI) | Sí (tsc auto-verificado por el propio agente) | 5 (5 ocurrencias, 2 archivos; sin renames no pedidos) | No |

*Fila dsh T2 (10-sep-2026): 7 llamadas a herramientas. Contraste directo con el "momento portada" de Aider en esta misma tarea: dsh verificó con tsc dentro de su loop y no consolidó nada roto. Coste: 43,9K tok vs ~3,3K de D-Engine Fast v0.2 + P9 en la misma tarea (~13×).*

## T3 — guarda applyDiscount (>100 o negativo)

*Primera ronda ANULADA (tarea defectuosa: la guarda ya existía en la base). Filas de abajo = ronda válida.*

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
En pricing.ts, haz que applyDiscount lance un error si el porcentaje es mayor de 100 o negativo
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1996 | 188 | ~0,0002 | 2s | Sí | 5 | No |
| D-Engine Verify | 1996 + 329 | 156 + 1 | ~0,0002 | 2,85s | Sí (auditoría OK) | 5 | No |
| OpenCode | ~8831 ctx | — | 0,00 | 8,1s | Sí | 5 | No |
| Aider | 2.1k | 364 | ~0,0002 | 5s | Sí (auto-commit eaf2d4b) | 5 | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~32,4K total (UI web) | — | n/d | 72,2s wall (6s según UI) | Sí | 5 (RangeError correcto; propaga vía calculateTotal) | No |

*Fila dsh T3 (10-sep-2026): solo 3 llamadas a herramientas. Gap wall/UI de 66s sin explicación clara (arranque + latencia/cola de API) — en el artículo se reportan ambas medidas. Tendencia dsh: 107K → 43,9K → 32,4K tok correlaciona con vueltas del loop (12 → 7 → 3 tool calls), no con dificultad de la tarea.*

## T4 — JSDoc en todas las funciones de utils.ts

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
Documenta todas las funciones de utils.ts con JSDoc
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2079 | 677 | ~0,0002 | 4s | Sí | 5 (6/6 funciones) | No |
| D-Engine Verify | 2079 + 983 | 662 + 1 | ~0,0003 | 4,5s | Sí (auditoría OK) | 5 (6/6) | No |
| OpenCode | ~9703 ctx | — | 0,00 | 19s | Sí | 5 (6/6) | No |
| Aider | 2.0k | 804 | ~0,0002 | 5s | Sí (auto-commit f953a42) | 5 (6/6) | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~103K total (UI web) | — | n/d | 32,0s wall (21s según UI) | Sí (tsc auto-verificado) | 5 (6/6 funciones; @throws solo donde realmente se lanza; {@link} internos; declara no haber corrido tests) | No |

*Fila dsh T4 (10-sep-2026): la tarea de escritura masiva (JSDoc ×6) dispara el consumo a 103K tok — rompe la tendencia a la baja (107→44→32→**103**). El coste del agentic loop depende de cuánto lee/escribe el modelo, no de la dificultad. D-Engine Fast en esta misma tarea: ~2,8K tok (~37× menos).*

## T5 — addToCart sin líneas duplicadas

*Primera ronda ANULADA (tarea defectuosa: la base ya incrementaba). Filas de abajo = ronda válida (base `afef8bd`).*

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
En cart.ts, haz que addToCart incremente la cantidad si el producto ya está en el carrito, en vez de duplicar la línea
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2143 | 136 | ~0,0002 | 2s | Sí | 5 (dedup + stock contra total) | No |
| D-Engine Verify | 2143 + 370 | 146 + 1 | ~0,0002 | 2,5s | Sí (auditoría OK) | 5 | No |
| OpenCode | ~9232 ctx | — | 0,00 | 13s | Sí | 5 | No |
| Aider | 2.1k | 474 | ~0,0002 | 4s | Sí (auto-commit e83dd8c) | 5 | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~32,5K total (UI web) | — | n/d | 14,6s wall (5s según UI) | Sí | 5 (dedup + stock contra cantidad acumulada — misma solución que D-Engine en v0.1) | No |

*Fila dsh T5 (10-sep-2026): 3 llamadas a herramientas. Nueva muestra de convergencia: dsh llegó a la misma solución (validar stock contra `newQuantity` acumulado) que D-Engine Fast en agosto.*

## T6 — TRAMPA: bug descuento después de IVA

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
En pricing.ts hay un bug: calculateTotal aplica el descuento después del IVA y debería aplicarlo antes. Arréglalo
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1998 | 145 | ~0,0002 | 2s | Sí | 5 | No |
| D-Engine Verify | 1998 + 350 | 145 + 35 | ~0,0002 | 2,5s | **No consolidó** — falso rechazo por bug de parsing (`OK —` verboso) | — | No |
| OpenCode | ~9115 ctx | — | 0,00 | 12s | Sí | 5 | No |
| Aider | 2.0k | 452 | ~0,0002 | 4s | Sí (auto-commit bc4d496) | 5 | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~32,3K total (UI web) | — | n/d | 35,4s wall (5s según UI) | Sí | 5 (fix mínimo: descuento sobre subtotal, IVA después; reduce intacto) | No |

*Fila dsh T6 (10-sep-2026): 3 llamadas a herramientas. El fix converge con la solución "de manual" de v0.1 (nota 5). Gap wall/UI: 30s fantasma.*

## T7 — formatPrice con parámetro de moneda (multi-archivo)

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
Haz que formatPrice acepte la moneda como parámetro con € por defecto, y actualiza pricing.ts para usarlo
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2863 | 428 | ~0,0003 | 3s | Sí | 5 (firma + 4 usos explícitos) | No |
| D-Engine Verify | 2892 + 481 | 199 + 85 | ~0,0003 | 4s | Sí (OK_CON_OBSERVACIONES certero) | 4 (rename no pedido de EURO_SYMBOL; no tocó index.ts) | No |
| OpenCode | ~9949 ctx | — | 0,00 | 10s | Sí | 5 (mínimo y justificado) | No |
| Aider | 2.2k | 1100 | ~0,0003 | 7s | Sí (auto-commit 60d85ec) | 4 (mismo rename no pedido) | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~73,6K total (UI web; 96% cache hit) | — | n/d | 24,6s wall (16s según UI) | Sí (tsc auto-verificado) | 4 (firma correcta, EURO_SYMBOL intacto, callers de index.ts sin tocar; pero añade formatTotal — API nueva no pedida, declarada transparentemente) | No |

*Fila dsh T7 (10-sep-2026): 9 llamadas a herramientas. La tarea tiene un defecto de especificación leve (tercero tras T3/T5): pricing.ts no llamaba a formatPrice, así que "actualiza pricing.ts para usarlo" obliga a inventar un punto de uso. dsh lo resolvió declarando la interpretación y ofreciendo ajuste — comportamiento ejemplar, puntuado 4 por consistencia con el baremo v0.1 (cambios no pedidos = -1). Dato para el artículo: 96% de acierto de caché DeepSeek — tokens ≠ coste real.*

## T8 — extraer calculateTax

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
Extrae el cálculo del IVA a una función calculateTax en pricing.ts y reutilízala en calculateTotal
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1999 | 141 | ~0,0002 | 2s | Sí | 5 (matiz: doble redondeo en applyTax) | No |
| D-Engine Verify | 1999 + 428 | 167 + 1 | ~0,0002 | 3s | Sí (auditoría OK) | 5 (guarda TypeError extra, coherente) | No |
| OpenCode | ~11591 ctx | — | 0,00 | 25,1s | Sí | 5 (byte idéntico a Fast) | No |
| Aider | 2.0k | 410 | ~0,0002 | 3,5s | Sí (auto-commit 38fa465) | 5 (byte idéntico también) | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~113K total (UI web) — máximo de la ronda | — | n/d | 29,2s wall (21s según UI) | Sí (tsc + ejecución real: salida idéntica 243,27 €) | 5 (calculateTax extraída y reutilizada; conserva el orden descuento/IVA de la base — correcto, T8 no pedía arreglarlo; declara duplicación con taxAmount y applyTax sin uso) | No |

*Fila dsh T8 (10-sep-2026): 11 llamadas a herramientas. Nivel de verificación superior a cualquier contendiente v0.1: compiló Y ejecutó el programa para confirmar salida idéntica. Detectó que taxAmount ya tenía el mismo cuerpo y que applyTax quedaba sin consumidores, y lo reportó como fuera de alcance sin tocar API pública — disciplina de scope ejemplar. El coste de tanta diligencia: 113K tok (~53× D-Engine Fast v0.1, que hizo el mismo cambio byte-equivalente por 2,1K tok).*

## T9 — TRAMPA: "optimizar" calculateTotal con reduce (ya usa reduce)

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original):**

```
Optimiza calculateTotal usando Array.reduce manteniendo el redondeo a 2 decimales correcto
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1993 | 148 | ~0,0002 | 2,5s | Sí | 4 (redondeo intacto; "optimización" cosmética) | No |
| D-Engine Verify | 1993 + 352 | 151 + 86 | ~0,0002 | 4,5s | Sí (OK_CON_OBSERVACIONES detectó la cosmética) | 4 | No |
| OpenCode | ~10490 ctx | — | 0,00 | 24,7s | Sí | 4 (único que admitió "ya usaba reduce") | No |
| Aider | 2.0k | 503 | ~0,0002 | 5s | Sí (auto-commit db851c8) | 4 (byte idéntico a Fast) | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~214K total (UI web) — máximo absoluto de la ronda | — | n/d | 60,1s wall (49s según UI) | Sí | 4 (admite "ya usaba reduce" — como OpenCode en v0.1; pero compactación cosmética en calculateTotal + fix NO pedido de round2 en utils.ts que cambia el redondeo de todo el sistema (1.005: 1,00→1,01); **alucinación confirmada**: reportó products.ts corrupto ("línea 16: ndProduct") y el archivo está sano — findProduct intacto, tsc limpio) | **Sí: utils.ts** |

*Fila dsh T9 (10-sep-2026): 20 llamadas a herramientas — la trampa produce el comportamiento más complejo de la ronda. Lo ejemplar: admitió la trampa ("ya usaba reduce") y encontró un bug real de redondeo binario en round2 (1.005*100 = 100.49999… → Math.round baja a 1,00). Lo discutible: el prompt pedía "manteniendo el redondeo correcto" y dsh lo interpretó como licencia para CAMBIAR el redondeo de todo el sistema (fix con toPrecision(15)) — la respuesta ideal de la trampa era reportar el hallazgo, no aplicarlo; y reportó products.ts corrupto ("línea 16: ndProduct, falta el fi; rompe la compilación de todo el proyecto") con tsc pasando a la vez — **alucinación confirmada**: verificado con Test-Path + type, el archivo está íntegro. Primera alucinación documentada de dsh en el benchmark (con evidencia falsa a nivel de línea y autocontradicción en el mismo mensaje). Pendiente: revisar la pestaña Trayectoria para distinguir alucinación del modelo vs bug de lectura de la herramienta. Guiño documental: es el mismo nombre de archivo del "products.ts fantasma" de D-Engine v0.2 (coincidencia pura, sistemas distintos). Primera fila dsh con archivos fuera del objetivo. Coste de la diligencia desatada: 214K tok — **100× D-Engine Fast** en la misma tarea (2,1K), y 6,6× de varianza entre tareas dsh (32K–214K).*

## T10 — sistema de cupones con caducidad

**Prompt literal (canónico — congelado 10-sep-2026, texto de la especificación original; sin mencionar archivo a propósito):**

```
Añade un sistema de cupones: tipo Coupon con código, porcentaje y fecha de expiración, y una función applyCoupon que valide la fecha antes de aplicar
```

| Contendiente | Tokens in | Tokens out | Coste € | Tiempo | ¿Compila 1ª? | Cumple 1-5 | ¿Archivos de más? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2049 | 268 | ~0,0002 | 3,5s | Sí | 5 (now inyectable — testeable) | No |
| D-Engine Verify | 2049 + 512 | 226 + 1 | ~0,0003 | 4s | Sí (auditoría OK) | 5 | No |
| OpenCode | ~9101 ctx | — | 0,00 | 16,5s | Sí | 5 | No |
| Aider | 2.1k | 591 | ~0,0002 | 6s | Sí (auto-commit 469bc9e) | 5 (validación extra de porcentaje) | Sí: `.gitignore` |
| dsh (V4.1-Flash, fábrica) | ~179K total (UI web) | — | n/d | 46,8s wall (39s según UI) | Sí (tsc + demo ejecutada + suite de 23 casos de borde escrita, corrida y eliminada) | 5 (Coupon + applyCoupon con now inyectable; día natural, hora local, rechazo de fechas inválidas/NaN, desbordamiento JS, orden de validación; detectó el hueco de applyDiscount 0-100 de la base y NO lo tocó) | No (creó src/coupons.ts — el propio entregable — e integró la demo en index.ts) |

*Fila dsh T10 (10-sep-2026): 19 llamadas a herramientas, planificación con lista de tareas (4 completadas). La implementación más completa de la historia del benchmark en esta tarea — incluida la capacidad de crear archivos nuevos, que D-Engine v0.1 no tenía (limitación 8). Bonus de coherencia: re-descubrió en la base el hueco de applyDiscount que T3 pedía arreglar, y lo reportó sin tocarlo.*

---

## Resultados globales (v0.1 + ronda dsh 10-sep-2026 completa)

**Cumplimiento total (máx 50):**

| Contendiente | Puntos | Incidencias |
| --- | --- | --- |
| OpenCode | 49/50 | 4 en T9 |
| D-Engine Fast | 48/50 | 4 en T9; rechazo seguro en T3-1ª ronda (tarea defectuosa) |
| dsh (V4.1-Flash, fábrica) | 48/50 | 4 en T7 (formatTotal no pedido), 4 en T9 (fix round2 no pedido); **alucinación confirmada de products.ts en T9** (pidió permiso, no tocó); compila 10/10 con auto-verificación |
| Aider | 47/50 | 4 en T7, 4 en T9; **master roto commitado en T2** |
| D-Engine Verify | 46/50 | 4 en T7, 4 en T9; falso rechazo en T6 (bug parsing) |

**Tokens por tarea (media aprox.):** Fast ~2.100 · Verify ~2.600 · Aider ~2.100 · OpenCode ~9.700 (4-5× Fast) · **dsh ~93.000 (rango 32K–214K; ~44× Fast; total ronda ~931K vs ~21K de Fast)**

**Tiempo medio por tarea:** Fast ~2,7s · Verify ~3,7s · Aider ~4,9s · OpenCode ~14,9s · **dsh ~38s wall (~20s según su UI; el gap entre ambas medidas es errático: 9-66s fantasma)**

**Archivos de más:** D-Engine y OpenCode: ninguno. Aider: `.gitignore` en las 10 tareas (su propia config). dsh: `utils.ts` en T9 (fix de round2 no pedido); en T10 creó `coupons.ts` (entregable) e integró `index.ts` (demo).

**Lectura de la ronda dsh:** calidad máxima del benchmark (diligencia, auto-verificación con tsc y ejecución real, transparencia de scope, testing ad-hoc) a coste impredecible (6,6× de varianza entre tareas). La tesis no es "los agentes fallan" — es que **el agente decide cuánto gastas y cuándo se sale del scope; el pipeline determinista no**.

---

## Notas e incidentes

1. **Tareas defectuosas detectadas en vivo (T3 y T5)**: el bench-repo, generado por OpenCode, ya incluía guardas que las tareas pedían añadir. OpenCode lo detectó y reportó honestamente ("ya está implementado"); D-Engine, forzado por su contrato a producir bloques SEARCH/REPLACE, generó parches basura que la puerta de compilación rechazó (TS1128 vía fuzzy). Lección: auditar la base antes de benchmark. Base corregida y tag `benchmark-base` movido dos veces (cf50c3c → afef8bd). Filas anuladas conservadas como evidencia.

2. **T2, momento portada**: Aider avisó de que no tenía todos los archivos en el chat ("no los tengo en el chat. Avísame si quieres que los revise")… y **auto-commitó igualmente un master que no compila** (TS2305). Sin puerta de compilación, la IA rompe y consolida.

3. **T6, falso negativo de Verify**: el auditor APROBÓ el fix correcto pero respondió `OK — explicación` (verboso); el parser solo acepta `OK` exacto / `OK_CON_OBSERVACIONES:` / `FALLO:` y lo trató como FALLO. El sistema falla hacia lo seguro (master intacto). **Fix v0.2 crítico**: aceptar prefijos o re-preguntar ante formato desconocido.

4. **T9, el auditor demuestra criterio**: ante un cambio cosmético (reduce ya existía), el auditor respondió OK_CON_OBSERVACIONES señalando "no hay evidencia de optimización adicional". La auditoría semántica no es un sello automático.

5. **Convergencia del modelo**: en T6, T8 y T9, tres contendientes produjeron archivos byte idénticos (mismo hash). Con el mismo modelo, la solución "de manual" converge — lo que diferencia a las herramientas es el mecanismo que rodea al modelo.

6. **Coste de la auditoría Verify**: entre 330 y 984 tokens por tarea (+15-30% sobre la propuesta). Seguridad semántica casi gratis.

7. **Fuzzy es el eslabón débil**: el único parche que rompió sintaxis en todo el benchmark llegó vía fuzzy (T3, 1ª ronda). Candidato v0.2: reintentar una vez con el error de compilación como feedback, o exigir Verify cuando el parche solo aplica vía fuzzy.

8. **Limitación documentada**: D-Engine v0.1 requiere scope explícito de archivos (P9 selector automático planeado para v0.2; se re-ejecutarán T2/T7/T10). Tampoco puede crear archivos nuevos (la TUI valida existencia).

9. **Known issue post-benchmark**: `commitAndMerge` hace `git add -A` en la fotocopia — arrastraría archivos untracked si los hubiera (pasó con node_modules en una sesión previa). Fix pendiente: stagear solo archivos tocados por el parche.

10. **Registro de prompts — incidente metodológico (declarado 10-sep-2026)**: los prompts literales tecleados en la ronda v0.1 no se conservaron. Las versiones anteriores de este documento solo guardaban encabezados-resumen de cada tarea, y los historiales de Aider/OpenCode no sobrevivieron en disco (`.aider*` no estaba en `.gitignore` y los `git clean -fd` lo eliminaron; OpenCode no conserva JSONs localizables). Las **especificaciones originales** de las 10 tareas se recuperaron de la conversación de diseño (agosto 2026). Consecuencias declaradas:
    - Las filas v0.1 se ejecutaron con **parafraseos** de esas especificaciones; el texto exacto solo está atestiguado para **T1** (reutilizado verbatim el 10-sep en la ronda dsh y en el control v0.2.2, lo que lo convierte en el ancla de comparabilidad entre eras).
    - **T2** se congela como «Renombra la constante TAX_RATE a IVA_RATE **en todo el proyecto**» según la evidencia de ejecución (verificación post-run sobre `pricing.ts` + `index.ts` en el historial de PowerShell; anexo v0.2 «prompt "en todo el proyecto"»), aunque la especificación original decía «en pricing.ts».
    - **T3–T10** se congelan con el texto exacto de la especificación de diseño recuperada.
    - Desde el 10-sep-2026 toda ejecución usa el prompt canónico copiado tal cual de este documento. Esta nota aparecerá en la sección de limitaciones del artículo.

11. **dsh alucina una corrupción (T9, ronda 10-sep-2026)**: dsh reportó `src/products.ts` corrupto ("línea 16: `ndProduct`, falta el `fi`; rompe la compilación de todo el proyecto") y ofreció corregirlo. Verificación manual: el archivo está íntegro y `tsc` pasa. La evidencia a nivel de línea era inventada y el propio mensaje se contradecía (afirmaba a la vez "verificado con tsc, sin errores"). Conducta segura (pidió permiso antes de tocar nada), pero un usuario que hubiera dicho "sí, corrígelo" habría introducido un cambio motivado por un hecho falso. Contraste arquitectónico: D-Engine no puede reportar estado falso del repo porque no opina sobre archivos — los lee, parchea y compila deterministamente; la verdad del sistema la da `tsc`, no el modelo.

## Anexo v0.2 — fixes + P9 (selector automatico de archivos)

Fixes aplicados tras el benchmark: (1) parser del auditor por prefijo (case-insensitive), (2) git add solo archivos del parche + guard porcelain endurecido, (3) reintento unico con feedback de tsc, (4) P9: Enter vacio = selector automatico con confirmacion del usuario.

| Tarea | Contendiente | Tokens in | Tokens out | Resultado |
|---|---|---|---|---|
| T6 bug descuento/IVA | Verify v0.2 | 1998 + 350 | 145 + 41 | ✅ Consolidado — auditor verboso (41 tok) aceptado por el parser nuevo. FIX 1 validado. |
| T2 rename (prompt "en todo el proyecto") | Fast v0.2 + P9 | 264 + 2762 | 11 + 295 | ✅ 5/5 — selector eligio pricing.ts + index.ts solo. La limitacion "scope explicito" resuelta. |
| T7 formatPrice (run A) | Fast v0.2 + P9 | 289 + 4453 | 23 + 406 | 🛡️ Sobre-seleccion (5 archivos); aparecio un products.ts fantasma y el guard de porcelain (FIX 2) aborto el merge. Master intacto. |
| T7 formatPrice (run B) | Fast v0.2 + P9 | 270 + 2086 | 5 + 151 | ✅ 4/5 — sub-seleccion (solo utils.ts); compila y funciona, usos no actualizados. |
| T10 cupones (sin mencionar archivo) | Fast v0.2 + P9 | 324 + 2822 | 11 + 226 | ✅ 5/5 — selector eligio pricing.ts + index.ts; el proposer solo toco pricing.ts. Scope amplio, bisturi preciso. |

Hallazgos P9: el selector NO es determinista (mismo prompt, 3 scopes distintos); la varianza de scope se traduce en varianza de resultado, pero la arquitectura la absorbe de forma segura. Coste del selector: 264-324 tokens por run.

Pendiente v0.2.1: prompt del selector pidiendo "minimo conjunto necesario"; loguear el diff del archivo ofensor cuando salte el guard; el guard debe presentarse como rechazo controlado, no "Error inesperado"; investigar el products.ts fantasma (no reproducido).

| T7 formatPrice (run C, v0.2.1) | Fast v0.2.1 + P9 | 336 + 3975 | 22 + 213 | ✅ 4/5 — selector pidio 4 archivos (instruccion "minimo conjunto" mejora pero no elimina la varianza); proposer solo toco utils.ts; SIN fantasma (FIX D validado); usos no actualizados. |

Nota v0.2.1: el guard de porcelain ahora loguea el diff ofensor antes de destruir la fotocopia y se presenta como rechazo controlado ("La puerta rechazo el cambio: ...") en vez de "Error inesperado". Causa del products.ts fantasma identificada y corregida: ensureDemoFile copiaba todos los objetivos al worktree antes de parchear.

### Run de control T1 — D-Engine v0.2.2 (10-sep-2026)
Contexto: DeepSeek retira V4-Flash y el alias deepseek-chat. Toda fila
ejecutada desde hoy corre sobre V4.1-Flash. D-Engine actualizado:
.env → deepseek-flash + thinking disabled (preserva la config efectiva
de la era v0.1: non-thinking). Commit 9b3739f.
Resultado T1: 2.552 tokens (selector 314 + propuesta 2.238), 2 llamadas
LLM, match por normalize-newlines, compila, solo src/utils.ts (+7 líneas).
Comparativa mismo-modelo (V4.1-Flash): D-Engine 2.552 tok vs dsh 107.000
tok → 42x menos. El gap de tokens es arquitectónico, no del modelo.
Nota: v0.2.2 incluye el selector P9 (314 tok), ausente en v0.1 — no afecta
a la conclusión.
Tiempo: ~4s de máquina (estimación del operador, consistente con v0.1:
Fast T1 = 2,5s sin selector). El wall-clock total medido con Stopwatch en
un rerun fue 85,9s — incluye la confirmación humana del selector P9 en la
TUI, componente que dsh headless no tiene; la comparación honesta es
tiempo de máquina: ~4s vs 48,9s. Medición exacta pendiente de v0.3
(imprimir tiempo y tokens en el resumen final de la TUI).

### Control dsh T1 — esfuerzo Apagado (10-sep-2026) — COMPLETADO
Objetivo: réplica non-thinking de la config efectiva de la era v0.1, para
blindar la tesis frente a la crítica "el gap es solo el esfuerzo/thinking".
Ejecutado desde la UI web de dsh (esfuerzo → Apagado) con el prompt
canónico de T1 y reset a benchmark-base.

Resultado: **37,1K tok, 6s (UI), 3 llamadas a herramientas**, misma
solución 5/5 (formatDate con guarda TypeError + padStart — converge con
D-Engine y con el propio dsh-Alto).

Descomposición del gap en T1 (mismo modelo V4.1-Flash, mismo prompt
literal, misma tarea):

| Config | Tokens | vs D-Engine |
|---|---|---|
| D-Engine v0.2.2 (thinking off) | 2.552 | 1× |
| dsh Minimal (shell único, thinking High) | ~34.600 | 13,6× |
| dsh Apagado (Standard, thinking off) | ~37.100 | **14,5×** ← overhead arquitectónico puro |
| dsh Alto (Standard, thinking on, fábrica) | ~107.000 | 42× |

Conclusión: el thinking AMPLIFICA el gap (~2,9× más tokens y 4× más
vueltas de loop: 12 vs 3 tool calls) pero NO lo explica. Con el modelo
idéntico y el razonamiento apagado, el agentic loop sigue quemando 14,5×
más tokens que el pipeline determinista para producir el mismo diff.
El gap es arquitectónico. Tesis blindada.

### Control dsh T1 — modo Minimal (10-sep-2026)
Objetivo: cerrar la objeción "benchmark en Standard, el modo gordo".
Minimal = agente de UNA herramienta (shell persistente); es el modo que
DeepSeek usó en sus benchmarks oficiales (changelog 31-jul-2026).

Resultado: **34,6K tok, 1m04s, 11 tool calls** (todo Pwsh: Get-ChildItem,
Get-Content ×4, Add-Content para la edición, re-lectura de verificación,
npm run build + ejemplo ejecutado). Solución correcta (sin guarda
TypeError esta vez — varianza de calidad entre configs del mismo modelo).

Hallazgo que corona el benchmark: **Minimal ≈ Standard-Apagado (34,6K vs
37,1K)**. Reducir la caja de herramientas NO reduce los tokens: el coste
no está en los schemas ni en el arsenal, está en el LOOP — cada turno
reenvía system prompt + trayectoria completa. Con una sola herramienta
primitiva el agente necesita incluso MÁS turnos (11 vs 3) para hacer lo
mismo, y tarda más (1m04s, el T1 más lento). Ni el toolbox ni el thinking
explican el gap: la estructura del agentic loop es el coste. D-Engine lo
elimina por construcción (2 llamadas, coste fijo).
