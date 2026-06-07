# Battle.net en Wine (Apple Silicon): problemas, soluciones y hacia dónde vamos

Documento de referencia para el trabajo de depuración de Kalimotxo con Battle.net en Mac M4 (y Apple Silicon en general). Resume lo que falló, qué lo arregló (o no), y el plan técnico para llegar a un botón «Jugar» fiable.

**Relacionado:** [D3DMetal y rendimiento](d3dmetal-and-performance.md) · [QA Battle.net](QA-BATTLENET.md)

---

## Resumen en una frase

**Battle.net arranca y muestra login con el Agent conectado** (jun 2026, noche). La instalación ya se completaba; el arranque del cliente requería, sobre Wine 11 + GPTK 3 + DXMT, **dos arreglos extra descubiertos esta sesión**: (1) copiar `libMoltenVK` + el bundle de `libgnutls` a `lib/wine/x86_64-unix/` porque macOS **borra `DYLD_*` en los hijos** de Wine, y (2) un **puente TCP 1120 → puerto de `Agent.dat`** porque el cliente conecta al 1120 fijo y el Agent (bajo Wine, no persistente) escucha en un puerto efímero. Ver «Sesión 2026-06-04 (noche)».

---

## Contexto

| Elemento | Valor habitual en pruebas |
|----------|---------------------------|
| App | Kalimotxo (Electron + TypeScript) |
| Datos | `~/.macbattlenet` o `~/.kalimotxo` |
| Bottle | `bottles/Battle.net` (`WINEARCH=win64`) |
| Cliente | `Battle.net.exe` (PE32, 32 bits) + CEF (`libcef.dll`) |
| Agente | `Agent.exe` (instalación/actualizaciones) |

Kalimotxo puede descargar, entre otros:

- **Wine Staging (macOS)** — builds Gcenx (p. ej. 11.9 en API; en disco a veces queda un `.app` antiguo).
- **Wine-Crossover** — solo **23.7.1-1** en el repo Heroic (Wine ~8.0.2 + parches CodeWeavers limitados).
- **Game Porting Toolkit** — GPTK empaquetado (Wine 7.7); útil para D3DMetal en juegos, **no** sustituto del Wine de Battle.net.

Mezclar versiones de Wine sobre el **mismo** `WINEPREFIX` sin `wineboot --update` deja DLLs y registro incoherentes y empeora los síntomas (ventana «actualizando Wine» infinita, crashes al arrancar).

---

## Cronología de problemas y soluciones

### 1. Carga infinita / `BLZBNTBNA00000005` (Agent dormido)

**Síntoma:** Battle.net no pasa de la pantalla de carga; el agente no responde.

**Causas identificadas:**

- `Agent.exe` podía **crashear** al inicializar Direct3D si el entorno forzaba DLLs builtin rotas en Apple Silicon (`d3d11=b`, `dxgi=b`, `d3d10core=b` en `WINEDLLOVERRIDES`).
- `WINE_DISABLE_VA_ALLOC=1` (pensado para lanzamiento de juegos) también se sospechó como factor de inestabilidad en el agente.

**Qué funcionó:**

- Quitar overrides `d3d11=b` / `dxgi=b` / `d3d10core=b` en `wineEnv.ts` para lanzamientos Battle.net.
- Quitar `WINE_DISABLE_VA_ALLOC` en ese modo.
- Mantener gestión del Agent en instalación sin depender de un «pre-calentamiento» conflictivo (ver punto 2).

---

### 2. Instalador atascado al **45%** / `BLZBNTBTS0000005C`

**Síntoma:** El instalador de Blizzard no avanza; error de comunicación con el Update Agent.

**Causas identificadas:**

- Con overrides D3D corregidos, **Agent.exe** arrancaba, creaba `Agent.dat` y escuchaba en un puerto HTTP, pero el instalador **seguía sin conectar** tras ~30 s.
- **Dos Agents a la vez:** `preWarmAgent()` dejaba un Agent vivo mientras el instalador lanzaba el suyo → carrera por `Agent.dat` y sesión.

**Qué funcionó:**

- Eliminar `preWarmAgent()` del pipeline de instalación y del «kick» del instalador.
- Tras eso, usuarios reportaron **instalación completada** («hemos conseguido instalar battle.net»).

**Estado:** Instalación considerada **resuelta** en el bottle actual; el bloqueo siguiente es el **arranque del cliente**.

---

### 3. «No arranca Battle.net» / ventana que no se ve

Varias capas distintas; conviene no mezclarlas.

#### 3a. Wine Staging — crash inmediato de CEF

**Log típico:**

```text
err:virtual:virtual_setup_exception nested exception on signal stack
```

**Causa:** Battle.net usa memoria tipo *copy-on-write* / excepciones que en macOS ARM necesitan el parche **`WINE_SIMULATE_WRITECOPY`** (origen CodeWeavers). Wine Staging **no** lo implementa igual → el proceso principal o CEF muere al poco.

**Intentos que no bastan solos:** `--in-process-gpu`, `--use-gl=swiftshader`, `--single-process`, `--no-sandbox`, `--disable-gpu`.

#### 3b. Wine-Crossover 23.7.1 — más lejos, pero el renderer CEF muere

**Qué sí pasa con CX + `WINE_SIMULATE_WRITECOPY=1`:**

- No aparece `nested exception` en el proceso padre.
- MoltenVK inicializa (M4 Pro).
- Se crean ventanas Win32 (`EnableNonClientDpiScaling`, `DwmExtendFrameIntoClientArea`, etc.).
- Arranca **Agent.exe**.

**Qué falla después:**

```text
ERROR:gpu_channel_manager.cc(884)] Failed to create GLES3 context, fallback to GLES2.
ERROR:gpu_channel_manager.cc(895)] ContextResult::kFatalFailure: Failed to create shared context for virtualization.
ERROR:gpu_channel.cc(601)] GpuChannel: Failed to create SharedImageStub
```

- El **subproceso** CEF (otro `Battle.net.exe`) no hereda bien `--in-process-gpu --use-gl=swiftshader` (Wine CX solo los añade al padre vía hack).
- ANGLE/`libEGL.dll` en WOW64 experimental no crea contexto GLES compartido → el canal GPU del renderer falla en fatal.
- Log del Agent: `No Connected Clients detected: Shutting Down` (~20 s) porque el cliente principal ya murió.
- A veces: `wineserver crashed` tras el fallo del renderer.

**Intentos sin éxito estable:** `--disable-gpu`, `--use-angle=gl`, `--use-angle=d3d11`, copiar DXMT a `syswow64` sin `WINEDLLPATH`, overrides `d3d11=n;dxgi=n` sin el Wine correcto.

#### 3c. Variables «tipo CrossOver» en Wine Staging

`WINE_SIMULATE_WRITECOPY` y `WINE_HEAP_ZERO_MEMORY` en **Staging** provocaron en algún momento **deadlock** en `loader_section` (ventana «actualizando Wine» que no termina). En **CX** WRITECOPY es necesario para el padre; HEAP_ZERO es coherente con D4Mac pero no arregla solo el renderer.

#### 3d. GPTK 3.0 empaquetado (Gcenx) sobre el mismo prefix

- Wine **7.7**; `wineboot --init` / mezcla con prefix de CX/Staging deja el bottle inconsistente.
- Arranque de `Battle.net.exe` casi sin log útil → salida silenciosa.

#### 3e. Referencia positiva: **D4Mac** (Wine 11.0 embebido)

Al reproducir manualmente el entorno de [D4Mac](https://github.com/MichaelLod/D4Mac) sobre el bottle **ya instalado**:

| Variable / flag | Rol |
|-----------------|-----|
| `WINE_SIMULATE_WRITECOPY=1` | Parche CEF / excepciones en macOS |
| `WINE_LARGE_ADDRESS_AWARE=1` | Cliente 32 bits grande |
| `WINE_HEAP_ZERO_MEMORY=1` | Alineado con D4Mac |
| `ROSETTA_ADVERTISE_AVX=1` | AVX bajo Rosetta |
| `WINEDLLOVERRIDES=winemenubuilder.exe=d;mscoree=d;mshtml=d` | Menos ruido / IE embebido |
| `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal` | Backend gráfico GPTK |
| `CX_APPLEGPTK_LIBD3DSHARED_PATH` → `libd3dshared.dylib` | D3DMetal |
| `DYLD_FALLBACK_LIBRARY_PATH` → `external/`, D3DMetal Resources | MoltenVK, D3DMetal |
| **`WINEDLLPATH`** → `lib/external/dxmt/i386-windows` (+ x86_64, wine builtins) | **Crítico:** DXMT como DLL **builtin** de Wine, no copias sueltas en `syswow64` |
| Args: `--in-process-gpu --use-gl=swiftshader` | CEF en un solo proceso GPU (cuando el hack del Wine lo aplica) |

**Resultado observado en prueba manual (jun 2026):** varios `Battle.net.exe` y `Agent.exe` vivos durante ~30–45 s (sin error GPU fatal en el log inicial), luego el cliente salía; Agent podía quedar colgado.

**Problemas pendientes con D4Mac Wine en nuestro prefix:**

- Wine D4Mac es **x86_64** (Rosetta): `wineboot --init` muy lento; mezclar con prefix creado por CX/Staging requiere `wineboot --update`.
- Avisos `Wine cannot find the FreeType font library` (en su build, fuentes vía CoreText; molesto pero no siempre fatal).
- `gnutls` / **schannel** no cargados en x86_64 (`no schannel support`) — HTTPS del stack Wine; Battle.net CEF usa **BoringSSL**, pero otros componentes pueden depender de schannel.
- `division by zero` en varios hilos (CEF); D4Mac **desactiva el diálogo de crash** de Wine en el registro para no bloquear el arranque.
- Procesos Wine huérfanos si no se hace `wineserver -k` entre pruebas.

---

### 4. Ventana «actualizando Wine» que no termina

**Causa probable:** cambio de binario Wine (Staging ↔ CX ↔ GPTK ↔ D4Mac) sobre el mismo `WINEPREFIX` sin completar `wineboot`, o procesos `rundll32`/wineboot colgados (Rosetta + instalación de `wine.inf`).

**Mitigación operativa:**

```bash
pkill -9 -f wineserver
pkill -9 -f wine
# luego un solo wineboot --update con el Wine definitivo
```

---

### 5. Muchas apps Wine abiertas / una sola instancia

**Causa:** pruebas repetidas sin matar `wineserver` y Agents viejos.

**Mitigación:** `stopWineProcesses` / `wineserver -k` antes de cada lanzamiento desde Kalimotxo; un solo flujo «Instalar» o «Abrir Battle.net».

---

## Qué tiene Kalimotxo hoy (código)

| Área | Estado |
|------|--------|
| `wineEnv.ts` | Lanzamiento BNet (cliente) exporta el stack D4Mac §3e: `WINE_LARGE_ADDRESS_AWARE`, `WINE_HEAP_ZERO_MEMORY`, `ROSETTA_ADVERTISE_AVX`, **`WINE_SIMULATE_WRITECOPY`** (omitido en Staging por deadlock), **`WINEDLLPATH`→DXMT builtin** (`i386-windows`+`x86_64-windows`), `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal` + `CX_APPLEGPTK_LIBD3DSHARED_PATH`, `DYLD_FALLBACK_LIBRARY_PATH`→D3DMetal/winemetal, overrides `mscoree=d;mshtml=d;location*=d;vcrt=n,b`. Todo *gated* por existencia del runtime (no-op si falta DXMT/D3DMetal). |
| `wineRunner.ts` | `applyBattleNetWindowsRegistry` desactiva el diálogo de crash de Wine (`WineDbg\ShowCrashDialog=0`) como D4Mac. |
| `service.ts` | Instalación sin `preWarmAgent`; lanzamiento con args CEF `--in-process-gpu --use-gl=swiftshader` vía `runExe` |
| Repos Wine | Staging + CX 23.7.1 + GPTK en `repositories.ts` — **ninguno** equivale al bundle Wine 11 + DXMT + GPTK de D4Mac. **Pendiente:** registrar un runtime «Wine-BattleNet» (Fase A.2). |
| Prefix usuario | Battle.net **instalado**; probado con varios Wines → riesgo de registro/DLLs mezclados |

> **Nota (jun 2026):** El bloque de env de la Fase A.3 ya está implementado y cubierto por tests (`wineEnv.test.ts`, `launchEnv.test.ts`). Lo que **bloquea la validación** es la Fase A.1/A.2: que el runtime Wine activo sea uno que soporte WRITECOPY (Wine 11 / CrossOver-based, no el Staging de Gcenx). Con Staging, `WINEDLLPATH`→DXMT se aplica pero WRITECOPY se omite a propósito → el cliente seguirá cayendo. Falta QA en hardware M-series.

---

## Hacia dónde vamos (roadmap técnico)

### Objetivo producto

Un solo botón en Kalimotxo: preparar bottle → instalar (si falta) → abrir Battle.net con ventana visible y login estable, luego juegos (p. ej. Diablo IV) con la capa gráfica adecuada (GPTK/D3DMetal para DX12, DXMT para DX11/CEF).

### Fase A — Runtime Wine «Battle.net ready» (bloqueante)

1. **Fijar un único Wine de referencia** alineado con D4Mac:
   - Wine **11.x** con parches CodeWeavers (fuente LGPL CX o build documentado `wine-cx26.1`).
   - **GPTK 3.x** (D3DMetal) + **DXMT** en `lib/external/dxmt/`.
   - MoltenVK / `libd3dshared.dylib` en `DYLD_FALLBACK_LIBRARY_PATH`.

2. **Descarga/instalación en Kalimotxo**
   - Nuevo tipo de instalación en `runtime/wine/` (p. ej. `Wine-BattleNet-latest`) o reutilizar GPTK + capa CX11 si hay tarball mantenido.
   - No ofrecer CX 23.7.1 como default para Battle.net si no pasa QA de arranque.

3. **`prepareLaunch` / `wineEnv.ts`**
   - Exportar el bloque de env de D4Mac (tabla arriba), incluido **`WINEDLLPATH`** hacia DXMT.
   - `WINE_SIMULATE_WRITECOPY` solo con Wines que lo soporten (detección por versión o por tipo de instalación).
   - Desactivar diálogo de crash Wine en el bottle (como D4Mac).

4. **Prefix limpio o migración** ✅ (asistente implementado)
   - Asistente **«Reparar bottle (Wine limpio)»**: `service.repairBottle()` (IPC `battleNetRepairBottle`, botón en `BattleNetPanel` → Opciones avanzadas). Para todo Wine → backup del registro (`prefixReconcile.backupBottleRegistry`) → un único `wineboot --update` con el **Wine activo** (`reconcileBottleWithActiveWine`) → reaplica el registro Battle.net (force) → reinstala verbs/deps → reinicia el Agent. **No borra `drive_c`**, así que conserva cliente y juegos. Para el caso de mezcla de Wines documentado en §4.
   - **Nota:** si el bottle quedó wedged con procesos Wine atascados en estado `U` (uninterruptible bajo Rosetta), hace falta **reiniciar** antes; `wineboot --update` por sí solo no los limpia.

### Fase B — Arranque estable del cliente

1. Validar en hardware real (M4): ventana visible > 60 s, login, Agent conectado (sin `No Connected Clients` prematuro).
2. Registro / config: «Disable browser acceleration» (WineHQ AppDB) vía `Battle.net.config` si hace falta.
3. Gestionar **subproceso CEF**: confirmar que Wine 11 propaga flags o forzar `--single-process` / política de GPU documentada en QA.
4. Dependencias x86_64 para Wine bajo Rosetta: **gnutls** (o documentar instalación `arch -x86_64 brew install gnutls` en wizard).

### Fase C — Producto Kalimotxo

1. Un solo `pkill`/`wineserver -k` antes de lanzar desde la UI.
2. Logs en `~/…/Logs/` con últimas líneas CEF/GPU para soporte.
3. QA: [`docs/QA-BATTLENET.md`](QA-BATTLENET.md) actualizado con matriz Wine × síntoma.
4. Opcional: inspiración en UX de D4Mac sin copiar su `.app` (licencias GPTK: redistribución no comercial).

### Fase D — Juegos (después de BNet estable)

Ya descrito en [d3dmetal-and-performance.md](d3dmetal-and-performance.md): Diablo IV → D3DMetal; títulos DX11 → DXMT.

---

## Sesión 2026-06-04 (tarde): cadena de causa raíz del arranque del cliente

Reproduciendo el stack D4Mac (**Wine 11.0 CodeWeavers + DXMT v0.72 + D3DMetal + MoltenVK**) directamente sobre el bottle `Battle.net` ya instalado, se aisló por fin **por qué el cliente arranca pero no muestra ventana**, y se resolvieron dos de los tres bloqueos. Cada paso está verificado con logs (`~/.macbattlenet/logs/bnet-*.log`, `libcef-*.log`, `Agent-*.log`).

### Bloqueo 1 — GPU/ANGLE (RESUELTO) → la ventana ya se crea

- `--use-gl=swiftshader` es **incorrecto** para esta build de CEF (Chrome 108). El log lo delata:
  `gl_factory.cc Requested GL implementation (gl=none,angle=none) not found in allowed implementations: [(gl=egl-angle,angle=default)]`. Solo admite **ANGLE/EGL**; con swiftshader el contexto GPU muere (`kFatalFailure: Failed to create shared context for virtualization`) y no hay ventana.
- **Causa raíz del «proceso vivo, sin ventana»:** Battle.net incluye su **propio `vulkan-1.dll` (SwiftShader headless)** en `Battle.net.<build>/`. El cargador de Windows lo resuelve desde el directorio del `.exe` **antes** que el de Wine, así que ANGLE usa ese SwiftShader, que **no expone `VK_KHR_surface` / `VK_KHR_win32_surface`** → ANGLE-Vulkan no puede crear swapchain → no se pinta.
- **Fix:** `WINEDLLOVERRIDES=…;vulkan-1=b` fuerza el `winevulkan` builtin de Wine (→ MoltenVK, **101 extensiones**, incluidas `VK_KHR_surface` y `VK_EXT_metal_surface`). Con esto ANGLE inicializa sobre Metal real.
- Quedaba un fallo de **enlace de shaders** Skia (`link failed`, usan `GL_NV_shader_noperspective_interpolation`, no soportado en ANGLE→MoltenVK). **Fix:** `--disable-gpu-compositing` → el compositor del navegador pinta por software (la UI 2D se presenta vía Metal igualmente). Con ello `link failed` desaparece y la **ventana del cliente se crea** (p. ej. 362×631, tamaño login).

**Flags definitivos del cliente:** `--use-angle=vulkan --disable-gpu-compositing` (ya en `service.ts`). **Override:** `vulkan-1=b` (ya en `wineEnv.ts`).

### Bloqueo 2 — TLS / red (RESUELTO) → el Agent ya hace HTTPS

- El Wine corre bajo **Rosetta (x86_64)** y su `secur32`/`bcrypt` cargan **gnutls** para TLS. No había `libgnutls.30.dylib` x86_64 (solo arm64 en `/opt/homebrew`) → `failed to load libgnutls` → el Agent fallaba HTTPS con **`CURL error 35`** y el cliente se quedaba colgado en «conectando».
- **Fix sin instalar nada:** los builds de **Wine-Crossover / GPTK / Staging** que ya descarga Kalimotxo empaquetan `libgnutls.30.dylib` x86_64 + sus dependencias (`nettle`, `hogweed`, `tasn1`, `p11-kit`, …) con `@loader_path` en `…/Resources/wine/lib`. Añadiendo ese directorio a `DYLD_FALLBACK_LIBRARY_PATH` (ya en `wineEnv.ts`, `resolveBundledGnutlsDir()`), el Agent pasa a **`CURL error 0`**.

### Bloqueo 3 — IPC cliente↔Agent local (PENDIENTE) → bloqueante actual

- Con gráficos y TLS resueltos, el cliente sigue sin pintar el login porque **no conecta con su Agent local**: `AgentClient failed to connect, CURL error=7` (conexión rechazada a `127.0.0.1`) en bucle, y el Agent se apaga con **`No Connected Clients detected: Initiating Shutdown Timer`** (~10 s).
- El Agent completa sus tareas de init (network check OK, `update_helper_service`, MD5 de `AgentHelper.exe`) pero **no llega a crear `Agent.dat` ni a aceptar el cliente**; los puertos en escucha del wineserver (p. ej. 22885/51630) no coinciden con lo que el cliente intenta. No hay crash de módulo del `Agent.exe` en el log.
- Es el clásico bloqueo del **Update Agent bajo Wine** y es **crítico**: el Agent gestiona instalar/actualizar/lanzar juegos, así que sin él no hay Diablo II: Resurrected aunque el login funcione.
- **Pendiente de investigar:** mecanismo de descubrimiento de puerto cliente↔Agent (¿`Agent.dat`? ¿registro? ¿named pipe?), posible IPv4/IPv6 (`::1` vs `127.0.0.1`), timing del listener, y el rol de `maintainBattleNetAgent`/`isAgentLaunchReady` en `service.ts`.

### Nota de entorno detectada

`resolveDataDir()` devuelve `~/.kalimotxo` en cuanto ese directorio existe, pero **todos los datos reales (bottles, runtime, wine) están en `~/.macbattlenet`**. Apareció un `~/.kalimotxo/cache` (extracción de `D4Mac-0.2.2.zip`) que ahora hace que la app mire en el sitio equivocado y crea que no hay runtime (2 tests de `runtimePaths` fallan por esto). **Acción recomendada:** consolidar en un único directorio de datos (mover/retirar `~/.kalimotxo` o migrar todo a él).

### Requisito de entorno: hardened runtime + DYLD

El Wine 11 de D4Mac está firmado con **hardened runtime** (`flags=0x10000(runtime)`). macOS **elimina las variables `DYLD_*`** al lanzar binarios hardened **salvo** que tengan el entitlement `com.apple.security.cs.allow-dyld-environment-variables`. El wine de D4Mac **sí lo tiene** (junto a `allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`), por lo que el `DYLD_FALLBACK_LIBRARY_PATH` que exporta `wineEnv.ts` (MoltenVK, D3DMetal, gnutls) **sí llega** a `winevulkan`/`secur32`. **Importante:** si se reempaqueta o re-firma el Wine, hay que conservar ese entitlement, o MoltenVK/gnutls dejarán de cargarse (ANGLE caería a SwiftShader → otra vez «sin ventana», y TLS volvería a `CURL 35`). Verificado: `codesign -d --entitlements - <wine>`.

### Aviso: degradación del prefix por pruebas repetidas

El arranque correcto (ventana 362×631, MoltenVK con `VK_KHR_win32_surface`, TLS OK) se reprodujo de forma **limpia** una vez; tras **decenas** de lanzamientos/`wineboot` de prueba (y con la instancia Electron del usuario lanzando `wineboot` de **Staging** en paralelo al principio), el **mismo** bottle dejó de inicializar MoltenVK aunque el binario Wine y los dylibs siguen válidos (entitlements intactos, `dlopen` por ruta absoluta OK). Es el modo de fallo que advierte §4 («mezclar Wines deja el prefix incoherente»). Para volver a validar conviene **partir de un prefix limpio**: reiniciar (limpia procesos Wine atascados en estado `U` que `kill -9` no mata bajo Rosetta) y o bien recrear el bottle, o un único `wineboot --update` con **solo** el Wine 11.

### Cómo reproducir el arranque (script de validación)

`~/.macbattlenet/logs/d4mac-launch-test.sh` exporta el stack D4Mac (Wine 11 + DXMT v0.72 + D3DMetal + MoltenVK + gnutls de Crossover, `vulkan-1=b`) y lanza con `--use-angle=vulkan --disable-gpu-compositing`. Verifica con `swift listwin.swift` (ventanas reales) y `screencapture`.

---

## Sesión 2026-06-04 (noche): CAUSA RAÍZ DEFINITIVA — los 3 bloqueos resueltos ✅

Reproduciendo el arranque sobre el runtime **registrado** `Wine-BattleNet-11.0` (no el `.app` de D4Mac, que ya no existe en disco) tras un reinicio limpio, se aisló por fin la causa raíz real y se llegó a **login funcional + Agent conectado**. Verificado con logs frescos (`~/.macbattlenet/logs/diag-*`, `battle.net-*.log`, `Agent-*.log`), `lsof` y `+winsock`/`+secur32`.

### Corrección importante a sesiones anteriores

Los bloqueos «GPU/ANGLE» y «TLS» que la sesión de la *tarde* dio por resueltos **estaban en realidad rotos** en el runtime registrado. Aquel arreglo se validó **una sola vez con el Wine dentro de `D4Mac.app`** (`Contents/SharedSupport/Wine`), no con la copia `Wine-BattleNet-11.0` que usa Kalimotxo. Síntoma de la copia: `Failed to load libMoltenVK.dylib` y `Failed to load libgnutls` en **todos** los procesos Wine del cliente.

### Causa raíz: macOS elimina `DYLD_*` en los procesos **hijos** de Wine

- El binario `wine` está firmado (Developer ID, hardened runtime) con `allow-dyld-environment-variables`, así que el proceso de arranque conserva `DYLD_FALLBACK_LIBRARY_PATH`. **Pero los hijos no:** Wine exec-a el preloader desde `$TMPDIR` y macOS **borra `DYLD_*`** en ese exec. Resultado: en el árbol cliente→Agent→renderers CEF, `DYLD_FALLBACK` no llega → ni **MoltenVK** (GPU) ni **libgnutls** (TLS) cargan.
- `winevulkan.so` y `secur32.so` tienen rpaths `@loader_path/`, `/usr/local/lib` y `@executable_path/../lib/external`. El tercero apunta a `$TMPDIR/lib/external` (porque `@executable_path` es el preloader en temp) → no existe. Solo `DYLD_FALLBACK` (eliminado) las encontraba en `lib/external`.
- **Fix (implementado):** copiar `libMoltenVK.dylib` y **el bundle completo de `libgnutls` (+ todas sus deps: libffi, libiconv, libintl, nettle, hogweed, p11-kit, tasn1, gmp, unistring, z…)** a `lib/wine/x86_64-unix/` del Wine activo. Ahí cargan por `@loader_path/` **sin depender de `DYLD_FALLBACK`**, en todo el árbol. Idempotente, en `src/backend/wine/wineRuntimeLibs.ts` (`ensureBattleNetWineRuntimeLibs`), llamado desde `service.launch()`. El bundle de gnutls debe copiarse **entero** (es auto-contenido vía `@loader_path` entre sus dylibs); copiar piezas sueltas rompe deps (`libffi.8`, `_libiconv`).
- Con esto: `101 Vulkan extensions` (MoltenVK), `Failed to load libgnutls = 0`, Agent network check **`CURL error 0`** (era 35), cliente schannel **sin** `SEC_E_SECPKG_NOT_FOUND`, y **ventana de login 362×631 visible** con la página `account.battle.net` cargada (`statusCode=200`), `link failed = 0`.

### Bloqueo 3 (Agent IPC) por fin entendido: puerto fijo 1120 vs efímero en `Agent.dat`

- El cliente conecta **siempre** a `127.0.0.1:1120` (visto en `+winsock`: cientos de `connect ... port 1120`). Pero el Agent bajo Wine **nunca bindea 1120**: abre un puerto **efímero** (p. ej. 54156→54499, cambia en cada arranque) y lo escribe en `C:\ProgramData\Battle.net\Agent.dat` (fichero ASCII con solo el nº de puerto). El cliente **no lee `Agent.dat`** → `AgentClient failed to connect, CURL error=7` en bucle → Agent se apaga por «No Connected Clients» → `BLZBNTBNA00000005`.
- En Windows real el Agent es **persistente** (servicio) y ya escucha cuando el cliente arranca; el desajuste no se nota. Bajo Wine sí.
- **Fix (implementado):** un puente TCP en Node escucha en `127.0.0.1:1120` y reenvía cada conexión al puerto real leído de `Agent.dat`. En `src/backend/storeManagers/battlenet/agentPortBridge.ts` (`startAgentPortBridge`), arrancado en `service.launch()` antes de lanzar el cliente. Validado: con el puente, `AgentClient failed = 0`, `BLZBNTBNA = 0`, el Agent responde `Response 200` (sesión), `TactVersionWatcher: Fetched new tact metadata`, `Products updated`. **El cliente queda en login y con catálogo → se puede instalar D2R.**

### Estado tras esta sesión

| Bloqueo | Estado | Fix |
|---------|--------|-----|
| GPU/ANGLE (MoltenVK) | ✅ resuelto | `libMoltenVK.dylib` → `lib/wine/x86_64-unix/` |
| TLS (schannel/gnutls) | ✅ resuelto | bundle gnutls completo → `lib/wine/x86_64-unix/` |
| Agent IPC (1120) | ✅ resuelto | puente Node 1120 → `Agent.dat` |

Pendiente: validar el flujo **completo desde la UI de Kalimotxo** (botón «Abrir Battle.net»), login real e **instalación de D2R** end-to-end; y, opcionalmente, que `ensureBattleNetWineRuntimeLibs` se ejecute también al **instalar/sincronizar el runtime** (hoy se garantiza en cada `launch()`).

> **Nota datos:** `~/.kalimotxo` ya no existe → `resolveDataDir()` usa `~/.macbattlenet` (datos reales). Si reaparece un `~/.kalimotxo` con contenido parcial, volvería a confundir a la app (ver nota de la sesión de la tarde).

---

## Matriz rápida: síntoma → causa probable

| Síntoma | Causa probable | Dirección |
|---------|----------------|-----------|
| 45 % instalador / `BLZBNTBTS0000005C` | Dos Agents o D3D builtin roto | Sin preWarm; sin `d3d11=b` |
| `nested exception on signal stack` | Wine sin WRITECOPY (Staging) | Wine CX11 / D4Mac stack |
| Proceso vivo, sin ventana | `DYLD_*` borrado en hijos → sin MoltenVK | Copiar libs a `lib/wine/x86_64-unix/` |
| `CURL error 35` / schannel `SECPKG_NOT_FOUND` | `DYLD_*` borrado → sin gnutls | Bundle gnutls → `lib/wine/x86_64-unix/` |
| `AgentClient CURL error=7` / `BLZBNTBNA00000005` | Cliente→1120 fijo; Agent→puerto de `Agent.dat` | Puente 1120 → `Agent.dat` (`agentPortBridge`) |
| Agent se apaga a los 20 s | Cliente nunca conectó (ver arriba) | Puente 1120 + libs |
| «Actualizando Wine» infinito | Cambio de Wine en prefix | Un Wine + wineboot |
| Muchos `wine`/`Agent` | Sesiones de prueba | Matar wineserver entre intentos |

---

## Comandos útiles (depuración local)

Prefijo y rutas (ajustar si usas `~/.kalimotxo`):

```bash
export WPREFIX="$HOME/.macbattlenet/bottles/Battle.net"
export BNET="$WPREFIX/drive_c/Program Files (x86)/Battle.net/Battle.net.exe"

# Ver Agent
cat "$WPREFIX/drive_c/ProgramData/Battle.net/Agent/Agent.dat"
tail -30 "$WPREFIX/drive_c/ProgramData/Battle.net/Agent/Logs"/Agent-*.log

# Limpiar Wine
pkill -9 -f wineserver; pkill -9 -f wine-preloader; sleep 2
```

Lanzamiento manual con Wine D4Mac (extraído del `.zip` de releases) — **solo después** de alinear `WINEDLLPATH` y env; ver tabla en §3e.

---

## Referencias externas

- [D4Mac](https://github.com/MichaelLod/D4Mac) — Battle.net + Diablo IV verificados; stack Wine 11 + GPTK 3 + DXMT.
- [WineHQ AppDB — Battle.net](https://appdb.winehq.org/objectManager.php?iId=28855) — Win10+, desactivar aceleración del navegador, Staging recomendado (genérico; en ARM el stack concreto importa más).
- [Heroic wine-crossover releases](https://github.com/Heroic-Games-Launcher/wine-crossover/releases) — solo 23.7.1 hoy.
- [Gcenx macOS Wine builds](https://github.com/Gcenx/macOS_Wine_builds/releases) — Staging con hack «Battle.net» en changelog 10.13+; no sustituye DXMT+GPTK de D4Mac en nuestras pruebas.

---

## Historial de este documento

| Fecha | Notas |
|-------|--------|
| 2026-06-03 | Primera versión tras depuración intensiva (instalación OK, arranque cliente en progreso; validación manual con Wine D4Mac). |
| 2026-06-04 (noche) | **Los 3 bloqueos resueltos → login funcional + Agent conectado.** Causa raíz: macOS borra `DYLD_*` en los hijos Wine (sin MoltenVK ni gnutls). Fix: libs a `lib/wine/x86_64-unix/` (`wineRuntimeLibs.ts`) + puente TCP 1120→`Agent.dat` (`agentPortBridge.ts`), cableados en `service.launch()`. Corrige el supuesto «GPU/TLS resueltos» de la tarde (solo iban con el Wine de `D4Mac.app`, no con la copia registrada). |
| 2026-06-04 (tarde) | **Cadena de causa raíz del arranque aislada y 2/3 bloqueos resueltos** (ver sección «Sesión 2026-06-04 (tarde)»): GPU/ANGLE (`vulkan-1=b` + `--use-angle=vulkan --disable-gpu-compositing` → la ventana se crea) y TLS (gnutls x86_64 de Crossover en `DYLD_FALLBACK` → Agent HTTPS OK). **Bloqueo restante: IPC cliente↔Agent local** (`CURL error=7` / `No Connected Clients`). Cambios en `wineEnv.ts` y `service.ts` + tests. |
| 2026-06-04 | **Fase A.3 implementada en código:** `wineEnv.ts` exporta el stack D4Mac (`WINEDLLPATH`→DXMT, WRITECOPY gated, HEAP_ZERO, D3DMetal, DYLD fallback) y `wineRunner.ts` desactiva el diálogo de crash. Tests actualizados (ya no se exige `d3d11=b`/`WINE_DISABLE_VA_ALLOC` en el cliente). Pendiente Fase A.1/A.2 (runtime Wine 11+DXMT) y QA en M-series. |

Si cambias el runtime Wine por defecto en Kalimotxo, actualiza este fichero y `docs/QA-BATTLENET.md`.
