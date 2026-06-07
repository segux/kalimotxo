# Migración a Electron + TypeScript + React (estilo Heroic)

## Arquitectura objetivo (como Heroic)

```
src/
  backend/     → proceso principal Electron (ventana, IPC, tiendas, Wine…)
  preload/     → puente seguro `window.api`
  frontend/    → React + MUI
  common/      → tipos compartidos
kalimotxo/     → Python (fase 1) → portar a `src/backend/` (fase 2–4)
```

## Estado actual (fase 1)

| Capa | Estado |
|------|--------|
| Electron + electron-vite | Esqueleto en raíz del repo |
| React (Battle.net, Wine) | Pantallas mínimas |
| Python | `python -m kalimotxo.daemon` — misma API Flask que antes |
| Flask + pywebview | Sigue disponible (`python run.py`) |

## Cómo arrancar la app Electron

```bash
# Terminal 1 — dependencias Python (sin cambios)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Terminal 2 — UI Electron
npm install
npm start
```

## Fases de migración (recomendado)

### Fase 2 — IPC tipado y paridad de API
- Mapear todos los endpoints de `kalimotxo/routes/*` en `src/preload/api/`
- Sustituir `fetch` genérico por métodos (`installBattleNet`, `launchStore`, …)
- Socket.IO para progreso de instalación (como eventos Heroic)

### Fase 3 — Portar backend a TypeScript
Orden sugerido (como Heroic: `storeManagers` + `launcher` + `tools`):

1. `config`, rutas de datos `~/.kalimotxo`
2. `wine_manager` (descargas GitHub, activar versión)
3. `bottle`, `wine_runner`, `process_manager`
4. `battlenet` / `stores/providers/battlenet`
5. `dependencies` / winetricks (spawn)
6. Resto: registry, performance, file browser

### Fase 4 — Empaquetado
- `electron-builder` (mac arm64 + x64)
- Incluir Python embebido o sidecar en `Resources/python` (como muchos ports de Wine en Mac)
- Eliminar Flask/pywebview del camino por defecto

## Qué no copiar de Heroic tal cual

- Legendary / GOG / Nile (no aplican a Kalimotxo)
- Proton / Steam runtime (enfoque macOS: Wine-GE / Gcenx / GPTK)
- Flatpak / Deck

## Referencia en el repo

`HeroicGamesLauncher/` — solo lectura; no modificar. Usar como guía de carpetas y patrones (`addHandler`, `preload/api`, `electron.vite.config.ts`).
