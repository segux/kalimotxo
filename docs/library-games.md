# Juegos fuera de Battle.net (biblioteca)

Cómo instala y lanza Kalimotxo juegos que no vienen de Battle.net, y por qué. Cada punto nació
de un fallo real (el primero, instalar *Diablo II* clásico con el descargador de Blizzard).

## El bottle «Games»

Todos estos juegos comparten el bottle `~/.kalimotxo/bottles/Games`, separado del de Battle.net.
Se prepara una vez (`src/backend/library/bottle.ts`, `ensureGamesBottle`):

1. `wineboot --init` con `mscoree,mshtml=` desactivados: si no, Wine abre el diálogo de instalar
   Mono/Gecko y `wineboot` se queda colgado minutos.
2. Registro por defecto (Windows 10, renderer Vulkan, sin diálogo de crash) en un solo `regedit`.
3. winetricks: `vcrun2022` y `d3dcompiler_47`.
4. **Wine Gecko y Wine Mono** (`src/backend/wine/addons.ts`), en la versión exacta que pide el Wine
   activo: versión y SHA-256 se leen de su `appwiz.cpl`, se descargan a la caché de Wine
   (`~/.cache/wine`), se verifican, se instalan con `msiexec` y se registra `mshtml`.
   - Sin Gecko + `mshtml` registrado, cualquier navegador incrustado sale en blanco (el contrato
     del instalador de Diablo II: `ieframe: BindToObject failed: 80040154`, clase no registrada).
     Desactivarlo en el paso 1 también se salta su registro, por eso se registra aquí.
   - Mono cubre juegos y lanzadores .NET.
   - Cada instalación se comprueba (carpeta `gecko/<versión>`, `mono/mono-2.0`) y se reintenta:
     justo después de winetricks el primer `msiexec` puede fallar.
5. **Carpetas de usuario aisladas**: Wine enlaza por defecto Documentos, Descargas, Música…
   de Windows con las del Mac. macOS pide entonces permiso a Kalimotxo y, si se deniega, los
   instaladores fallan. Se convierten en carpetas dentro del bottle (con un fichero marcador
   para que Wine no las vuelva a enlazar). Wine crea el perfil en la primera ejecución, así que se
   aplica al final de la preparación y antes de cada instalador y juego. Las carpetas del Mac
   nunca se tocan.

## Instaladores

`src/backend/library/service.ts`, `installFromInstaller`:

- El instalador se **copia dentro del bottle** y se ejecuta desde ahí: los descargadores (como el
  de Blizzard) guardan sus datos junto al `.exe`. Si ya está dentro del bottle (p. ej. el
  `Installer.exe` que dejó un descargador, que necesita su `.mpq` al lado), se ejecuta en su sitio.
- Se espera primero al proceso del instalador y luego a que el bottle quede inactivo
  (`wineserver -w`). Bajo Rosetta Wine tarda en arrancar; esperar solo al bottle devolvía antes de
  tiempo.
- Tras instalar se proponen los ejecutables nuevos **que pueden ser el juego**: nunca instaladores,
  descargadores, desinstaladores ni instaladores de runtimes. Si no hay una sugerencia fiable no se
  preselecciona nada. El ejecutable se puede cambiar después en los ajustes del juego.
- Algunos juegos se instalan en dos saltos (descargador → instalador). Si lo nuevo solo son
  instaladores, se pide elegir el juego a mano.

## Herramientas

winetricks necesita `cabextract`. La app lo lleva dentro (`resources/bundled/tools`, empaquetado en
CI) y lo pasa en el `PATH` de winetricks: una app abierta desde el Finder no ve Homebrew.

## Capa gráfica

Se detecta por las DLL de Direct3D que referencia el `.exe`: DX12 → D3DMetal, DX10/11 → DXMT,
DX9 y anteriores (DirectDraw incluido) → wined3d. Se puede cambiar por juego.
