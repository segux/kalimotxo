# Wine de Kalimotxo (compilado desde CrossOver)

Battle.net en Apple Silicon necesita un Wine basado en **CrossOver 26.x** (WRITECOPY, msync y
parches de CEF que el Wine upstream no tiene). Kalimotxo lo compila en su propio CI a partir del
código fuente LGPL que publica CodeWeavers y lo distribuye como release de este repo, para que
cualquier usuario lo obtenga sin instalar nada más y sin depender de builds de terceros.

## Qué contiene la release

`wine-cx-<versión>.tar.xz` (x86_64, corre bajo Rosetta):

- Wine WoW64 (`--enable-archs=i386,x86_64`) compilado desde
  `crossover-sources-<versión>.tar.gz`, **sin modificar**.
- `lib/external/`: librerías x86_64 de gnutls (TLS, con nettle y gmp), freetype (fuentes), SDL2
  (mandos) y MoltenVK (Vulkan→Metal), con referencias reescritas a `@loader_path`
  (`scripts/wine/bundle-dylibs.py`).
- `COPYING.LIB` y `SOURCE.md` con la URL y el sha256 exactos del código fuente (requisito LGPL).

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

La receta está adaptada de [mikaelhug/Silo](https://github.com/mikaelhug/Silo) (LGPL-2.1).

## Licencias

- Wine / CrossOver sources: LGPL-2.1. Redistribuimos binarios con la licencia y la referencia al
  código fuente correspondiente.
- Librerías de `lib/external`: cada una conserva su licencia (gnutls, nettle y gmp: LGPL; freetype:
  FTL/GPL-2; SDL2: zlib; MoltenVK: Apache 2.0).
- Kalimotxo no redistribuye D3DMetal.
