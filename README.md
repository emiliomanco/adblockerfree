# AdBlocker Free

Bloqueador de anuncios para Google Chrome **100% gratuito**: sin cuentas, sin
suscripciones, sin «anuncios aceptables» y sin enviar ningún dato a ningún
servidor. Bloquea los anuncios de las webs **y los de YouTube**.

Está inspirado en [AdBlock](https://getadblock.com/es/) y usa las mismas listas
de filtros de la comunidad (EasyList y EasyPrivacy).

## Qué hace

- **Bloquea anuncios y rastreadores** antes de que se descarguen (≈106.000 reglas
  de EasyList + EasyPrivacy con la API `declarativeNetRequest` de Chrome).
- **Oculta los huecos de los anuncios** (filtros cosméticos genéricos y por sitio).
- **Anuncios de YouTube**:
  - elimina los anuncios de vídeo antes de que el reproductor los programe
    (antes, durante y en medio del vídeo),
  - quita banners, anuncios del feed, de la búsqueda y de las sugerencias,
  - si aun así se cuela alguno, lo silencia, lo acelera ×16 y pulsa «Saltar»,
  - quita el aviso «Los bloqueadores de anuncios no están permitidos».
- **Bloquear un anuncio**: señalas con el ratón cualquier elemento de una web y
  queda oculto para siempre (como el «Bloquear un anuncio» de AdBlock).
- **Pausar** en un sitio concreto o en todas las webs con un clic.
- **Contador** de elementos bloqueados en el icono de la extensión.
- **Mis filtros**: añade tus propios filtros con la sintaxis de Adblock Plus / EasyList.
- Lista opcional de **molestias** (avisos de cookies, ventanas de suscripción,
  widgets sociales…).
- Interfaz en español (y en inglés si Chrome está en otro idioma), con modo oscuro.

## Instalación (2 minutos)

1. Descarga el proyecto: botón verde **Code → Download ZIP** en GitHub (y
   descomprímelo) o `git clone`.
2. Abre Chrome y entra en `chrome://extensions`.
3. Activa el **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta **`extension`** del proyecto.
5. Fija el icono rojo en la barra (icono de la pieza de puzle → chincheta).

¡Listo! No hace falta crear ninguna cuenta ni configurar nada.

> Chrome puede mostrar al arrancar un aviso sobre «extensiones en modo
> desarrollador». Es normal para extensiones que no vienen de la Chrome Web
> Store; basta con cerrarlo.

Funciona en Chrome 120 o superior y en navegadores basados en Chromium (Edge,
Brave, Opera, Vivaldi).

## Uso

Haz clic en el icono para ver:

- cuántos anuncios y rastreadores se han bloqueado en la página,
- un interruptor para **pausar en este sitio** (la página se recarga sola),
- **Bloquear un anuncio**: pasa el ratón por encima del anuncio, haz clic, ajusta
  la barra si quieres ocultar un bloque más grande y pulsa **Bloquear**
  (o **Intro**). **Esc** cancela,
- **Pausar en todas las webs**,
- el engranaje abre las **Opciones**: listas de filtros, sitios permitidos,
  «Mis filtros» y estadísticas.

## Sobre YouTube

YouTube cambia a menudo su forma de servir anuncios para esquivar a los
bloqueadores. AdBlocker Free ataca el problema en tres capas (datos del
reproductor, red y, como último recurso, saltar el anuncio), así que aunque
YouTube cambie una de ellas lo normal es que las otras sigan funcionando. Si
algún día vuelven a aparecer anuncios, actualiza la extensión (descarga de
nuevo el proyecto o `git pull`) y pulsa el botón de recargar en
`chrome://extensions`.

## Actualizar las listas de filtros

Las listas vienen incluidas en la extensión. Para descargar las versiones más
recientes de EasyList / EasyPrivacy necesitas [Node.js](https://nodejs.org) 18+:

```sh
npm install
npm run build:filters
```

Después recarga la extensión en `chrome://extensions`.

## Privacidad

- Sin cuentas ni inicio de sesión.
- Sin telemetría ni analítica: la extensión no hace **ninguna** petición a
  servidores propios ni de terceros.
- Los ajustes se guardan sólo en tu navegador (`chrome.storage.local`).

La extensión pide permiso para «leer y cambiar los datos de todos los sitios»
porque lo necesita para ocultar anuncios dentro de las páginas; no lee ni envía
tus datos a ningún sitio.

## Desarrollo

```
extension/            ← la extensión (esta es la carpeta que se carga en Chrome)
  manifest.json
  background/         service worker: reglas de red, filtros cosméticos, ajustes
  content/            scripts que corren en las webs (cosmético, YouTube, selector)
  popup/, options/    interfaz
  rules/              reglas declarativeNetRequest generadas desde las listas
  filters/            filtros cosméticos generados desde las listas
  _locales/           textos en español e inglés
scripts/
  build-filters.mjs   descarga y convierte EasyList / EasyPrivacy / Fanboy Annoyance
  messages.mjs        genera los textos de _locales
  make-icons.mjs      genera los iconos
  package.mjs         crea dist/adblockerfree-<versión>.zip
tests/e2e.mjs         pruebas en un Chromium real con la extensión cargada
```

Comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run build:filters` | Descarga y convierte las listas de filtros |
| `npm run build:locales` | Regenera los textos (`scripts/messages.mjs`) |
| `npm test` | Pruebas de extremo a extremo (requiere [Playwright](https://playwright.dev): `npm i -D playwright && npx playwright install chromium`) |
| `npm run package` | Crea un `.zip` listo para compartir o subir a la Chrome Web Store |

Las pruebas no necesitan internet: redirigen todos los dominios (doubleclick.net,
youtube.com…) a un servidor local con páginas de prueba, incluida una imitación
del reproductor de YouTube.

### Publicar en la Chrome Web Store (opcional)

Si quieres instalarla sin el modo desarrollador o compartirla, puedes subir el
`.zip` de `npm run package` a la Chrome Web Store. Google cobra una tasa única
de registro como desarrollador; la extensión sigue siendo gratuita.

## Créditos y licencias

- Listas de filtros: [EasyList, EasyPrivacy y Fanboy's Annoyance](https://easylist.to/),
  con licencia GPLv3 / CC BY-SA 3.0.
- Conversión a reglas de Chrome:
  [abp2dnr](https://gitlab.com/eyeo/adblockplus/abc/abp2dnr) de eyeo (sólo se
  usa al generar las listas, no se incluye en la extensión).
