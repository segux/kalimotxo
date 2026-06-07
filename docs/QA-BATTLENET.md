# QA Battle.net (E2E manual)

Ejecutar en **Mac Apple Silicon** con botella limpia y una vez con `~/.macbattlenet` migrada.

## Checklist

- [ ] 1. Borrar o renomar botella Battle.net para prueba limpia
- [ ] 2. `pnpm start` → Setup completo (Wine, DXMT, winetricks; cabextract + GStreamer OK)
- [ ] 3. Battle.net → Instalar → esperar 100 % Kalimotxo
- [ ] 4. Completar asistente Blizzard (descarga completa)
- [ ] 5. UI: badge **Cliente: instalación completa** (`client_complete = true`)
- [ ] 6. Reparar dependencias → sin error
- [ ] 7. Lanzar → sin diálogo *"A required DLL could not be found"*
- [ ] 8. Login Blizzard visible (CEF)
- [ ] 9. Cerrar cliente, Lanzar de nuevo → sigue OK
- [ ] 10. `pnpm run test:battlenet` → verde

## Automatizado

```bash
pnpm run test:battlenet
```

## Si falla

- Captura del diálogo DLL + últimas 80 líneas de `~/.kalimotxo/logs/battlenet-launch.log`
- `du -sh` carpeta Battle.net, `ls Battle.net.*`, `cat .patch.result`
- `ls syswow64/api-ms-win-crt*.dll` (tamaño &lt; 60 KB o overrides en registro)

## Release

No etiquetar **v1.0** hasta checklist 10/10 y tests verdes en `.app` empaquetada (`pnpm run dist:mac`).
