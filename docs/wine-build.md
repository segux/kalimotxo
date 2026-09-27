# Wine de Kalimotxo (compilado desde CrossOver)

Battle.net en Apple Silicon necesita un Wine basado en **CrossOver 26.x** (WRITECOPY, msync y
parches de CEF que el Wine upstream no tiene). Kalimotxo lo compila en su propio CI a partir del
código fuente LGPL que publica CodeWeavers y lo distribuye como release de este repo, para que
cualquier usuario lo obtenga sin instalar nada más y sin depender de builds de terceros.

## Qué contiene la release

`wine-cx-<versión>.tar.xz` (x86_64, corre bajo Rosetta):

- Wine WoW64 (`--enable-archs=i386,x86_64`) compilado desde
  `crossover-sources-<versión>.tar.gz`, **sin modificar**.
- `lib/wine/x86_64-unix/`: librerías x86_64 de gnutls (TLS, con nettle y gmp), freetype (fuentes),
  SDL2 (mandos) y MoltenVK (Vulkan→Metal), junto a los módulos de Wine, que las cargan por su rpath
  `@loader_path/` sin variables `DYLD_*` (macOS las borra en los procesos hijos de Wine). Referencias
  reescritas a `@loader_path` (`scripts/wine/bundle-dylibs.py`).
- `COPYING.LIB` y `SOURCE.md` con la URL y el sha256 exactos del código fuente (requisito LGPL).
- La release adjunta además el `crossover-sources-<versión>.tar.gz` usado, para no depender de que
  CodeWeavers lo mantenga publicado. El título la presenta como «Kalimotxo Wine … (built from
  CrossOver sources)»: es una compilación nuestra, no un producto de CodeWeavers.

**No contiene nada de Apple.** D3DMetal (GPTK) solo lo necesitan los juegos DX12 (p. ej. Diablo IV)
y Kalimotxo lo obtiene aparte. El cliente de Battle.net y D2R funcionan con este Wine + DXMT +
MoltenVK. DXMT también se descarga aparte (`runtime/dxmt`).

## Cómo se compila

Workflow `.github/workflows/build-wine.yml`, en un runner `macos-15` (Apple Silicon):

1. Herramientas de compilación (bison, pkgconf, ccache, cmake) del Homebrew nativo del runner y el
   compilador cruzado [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) (build universal oficial).
2. Librerías x86_64 compiladas desde su código fuente con versiones fijadas
   (`scripts/wine/build-deps.sh`, en caché) y MoltenVK desde su release oficial. Homebrew ya no se
   instala en x86_64 ni publica paquetes Intel, así que no se puede usar para esto.
3. `configure --enable-archs=i386,x86_64 --without-x --without-gstreamer` y `make` (x86_64).
4. Empaquetado de las librerías, prueba de humo (`wineboot --init` + `cmd /c ver`) y `.tar.xz`
   con su `.sha512sum`.

Disparadores:

- **Push a una rama `ci/wine-*`**: compila la versión por defecto (26.1.0) y deja el resultado como
  *artifact* del workflow, sin publicar. Sirve para iterar la receta.
- **`workflow_dispatch`** (con el workflow ya en `main`): elige versión y, con `publish`, crea la
  release `wine-cx-<versión>` (no se marca como *latest*, para no tapar las releases de la app).

### Publicar una versión (obligatorio probar Battle.net)

Las pruebas de CI (TLS, Vulkan, 32/64 bits) no bastan: `wine-cx-26.1.0` las pasaba y aun así el
cliente de Battle.net se cerraba al arrancar, porque su navegador interno (ANGLE sobre Vulkan) falla
con MoltenVK 1.3.x. Por eso el workflow crea la release como **borrador**, que la app no ve:

1. `gh workflow run build-wine.yml --ref <rama> -f crossover_version=26.1.0 -f revision=<n> -f publish=true`
2. Descargar el `.tar.xz` del borrador, instalarlo en `~/.kalimotxo/runtime/wine/`, activarlo en
   Ajustes → Wine y **abrir Battle.net de verdad** (login visible, sin «La aplicación ha detectado
   un error inesperado»), y lanzar un juego.
3. Solo entonces `gh release edit wine-cx-<versión> --draft=false --latest=false`.

Un arreglo del mismo CrossOver se publica como revisión (`wine-cx-26.1.0-2`); la app instala sola
la versión más nueva al abrir Battle.net.

La receta está adaptada de [mikaelhug/Silo](https://github.com/mikaelhug/Silo) (LGPL-2.1).

## Licencias

- Wine / CrossOver sources: LGPL-2.1. Redistribuimos binarios con la licencia y la referencia al
  código fuente correspondiente.
- Librerías empaquetadas: cada una conserva su licencia (gnutls, nettle y gmp: LGPL; freetype:
  FTL/GPL-2; SDL2: zlib; MoltenVK: Apache 2.0).
- Kalimotxo no redistribuye D3DMetal.

## DXMT y el Wine de Kalimotxo

Wine busca sus DLL builtin primero en su propio `lib/wine` y solo después en `WINEDLLPATH`, y
cambia cualquier DLL builtin que encuentre en otro sitio (system32, carpeta del juego) por la suya.
Por eso DXMT en `WINEDLLPATH` no sustituía a `d3d11`/`dxgi`: D2R acababa en wined3d (Vulkan →
MoltenVK) y se cerraba al entrar en partida (`MVKBufferView::getMTLTexture`).

Como los juegos de Battle.net se lanzan desde el propio cliente (botón Jugar), DXMT tiene que
funcionar con el Wine y el entorno del cliente:

- `winemetal.dll`/`winemetal.so` (el puente de DXMT a Metal) se añaden al `lib/wine` del Wine
  activo. Wine no trae ningún archivo con ese nombre, así que no cambia nada para el resto.
- `d3d11`, `dxgi` y `d3d10core` de DXMT se copian junto al `.exe` del juego sin la marca de DLL
  builtin de Wine y se cargan como *native* solo para ese ejecutable
  (`AppDefaults\<exe>\DllOverrides`).

Se aplica al abrir Battle.net y en cada lanzamiento desde Kalimotxo. Ver `src/backend/wine/dxmt.ts`.
