# 🚀 Proyecto D-Engine (Deterministic Engine) - Contexto y Arquitectura

## 1. Filosofía y Arquitectura Core
El objetivo de D-Engine es eliminar la "aritmética espacial" (errores de recuento de líneas) y la degradación de contexto en agentes de IA (Tool Calling ineficiente). 

**El paradigma:** Inteligencia probabilística en la nube (LLM) + Ejecución 100% determinista en local (IDE/Engine). 
La IA **no edita archivos directamente** ni lleva la cuenta de las líneas. Su única función es proponer bloques de reemplazo lógicos (Search/Replace). El motor local busca las "huellas dactilares" del código, verifica matemáticamente, compila y consolida.

## 2. Flujo de Trabajo Unificado
```text
                  ┌─────────────────────────────────────────┐
                  │ 1. LLM propone el cambio semántico      │
                  │    (Bloque SEARCH/REPLACE en Markdown)  │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │ 2. IDE / Runtime Local (Determinista)   │
                  │    Aplica el parche en "Fotocopia"      │
                  │    (Git Worktree) y corre el compilador │
                  └────────────────────┬────────────────────┘
                                       │
                        ¿Compila bien el código local?
                                       │
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
                 [ NO ]                               [ SÍ ]
         Rollback en la fotocopia                 ¿El usuario activó
         y reintentar con el error.               --verify?
                                                         │
                                         ┌───────────────┴───────────────┐
                                         ▼                               ▼
                                   [ NO / Cambio                    [ SÍ / Cambio
                                       Chorra ]                       Crítico ]
                                         │                               │
                                         ▼                               ▼
                               Consolidar cambio          Enviar solo el snippet
                               en disco real              modificado a la IA
                                (1 Llamada HTTP)          para auditoría semántica
                                                                 │
                                                                 ▼
                                                          Consolidar cambio
                                                             (2 Llamadas HTTP)