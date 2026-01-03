
# dgt_mapa_app

Aplicación web para visualizar incidencias de tráfico de la DGT sobre un mapa interactivo (Leaflet), con filtros, refresco automático, balizas (icono V16) y endpoint de API servido en el edge mediante **Cloudflare Pages Functions**.

El objetivo es que el usuario final solo abra una URL (sin instalar Docker/Go/exes). La web se despliega en **Cloudflare Pages** y la “API backend” vive en `functions/api/traffic.js` como Function (`/api/traffic`) usando routing por estructura de carpetas.

---

## Tabla de contenidos

- [Qué incluye](#qué-incluye)
- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Cómo desplegar en Cloudflare Pages](#cómo-desplegar-en-cloudflare-pages)
- [Endpoints](#endpoints)
- [Configuración del frontend](#configuración-del-frontend)
- [Caché y refresco](#caché-y-refresco)
- [Desarrollo local](#desarrollo-local)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Licencia](#licencia)

---

## Qué incluye

- Mapa interactivo en el navegador.
- Carga de incidencias (JSON) desde `/api/traffic`.
- Render de geometrías (tramos/zona) en el mapa y “balizas” (marcadores) con icono PNG.
- UI con filtros por `causa` y `subcausa`.
- Refresco periódico y mejoras de robustez (timeout/cancelación/backoff si están activadas en el HTML).
- Diseño pensado para desplegar “todo en uno” en Cloudflare Pages (frontend + API serverless).

---

## Arquitectura

### Por qué no se usa Docker en el cliente
Un navegador no puede lanzar procesos locales (Docker/Podman/Go) por seguridad. Para evitar instalaciones en el usuario, el backend se mueve a la nube/edge como función serverless.

### Componentes
- **Frontend** (Cloudflare Pages): `index.html` + `imgs/*`.
- **API** (Cloudflare Pages Functions): `functions/api/traffic.js`.
  - Llama al upstream de DGT.
  - Decodifica la respuesta (Base64 + XOR con clave `'K'` si tu Function lo implementa así).
  - Devuelve JSON al frontend.
  - Aplica (recomendado) cache corto en el edge para reducir llamadas.

---

## Estructura del repositorio

Asegúrate de que el repo tiene esta estructura:

```text
/
├─ index.html
├─ README.md
├─ imgs/
│  └─ flashled-sos-v16.png
└─ functions/
   └─ api/
      └─ traffic.js
```

> `functions/api/traffic.js` es obligatorio para que exista `GET /api/traffic`.

---

## Cómo desplegar en Cloudflare Pages

### 1) Requisitos

- Cuenta de Cloudflare
- Repo en GitHub (este repo)


### 2) Crear el proyecto Pages (con Git)

1. Cloudflare Dashboard → **Workers \& Pages**
2. **Create application**
3. Selecciona **Pages** (no “Worker”)
4. **Connect to Git** → selecciona este repo
5. Build settings recomendados para site estático:
    - **Framework preset**: `None`
    - **Build command**: vacío o `exit 0`
    - **Output directory**: `/` (raíz)
6. Pulsa **Deploy**

### 3) Verificación tras el deploy

Cuando Cloudflare termine:

- Web: `https://TU-PROYECTO.pages.dev/`
- API: `https://TU-PROYECTO.pages.dev/api/traffic`

Abre `/api/traffic` en el navegador y comprueba que devuelve JSON (p.ej. con `situationsRecords`).

---

## Endpoints

### `GET /api/traffic`

Devuelve el JSON de incidencias decodificado que consume el frontend.

> Opcional (si lo implementas en tu Function):

- `GET /health`

---

## Configuración del frontend

### Producción (Cloudflare Pages)

Como la API está en el mismo dominio, usa ruta relativa:

```js
const API_BASE = "";
// ...
const r = await fetch(`/api/traffic`, { method: "GET", signal: controller.signal, cache: "no-store" });
```


### Modo dual (dev local + prod Pages) — opcional

Si quieres mantener backend local en `http://localhost:8080` para desarrollo:

```js
const API_BASE =
  (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "http://localhost:8080"
    : "";

const r = await fetch(`${API_BASE}/api/traffic`, { method: "GET", signal: controller.signal, cache: "no-store" });
```


---

## Caché y refresco

### Caché (recomendado en `functions/api/traffic.js`)

Para reducir coste y evitar saturar el upstream:

- Cache edge: 30–60s suele ir bien.
- Si hay muchos usuarios, evita que cada refresco sea una llamada directa a DGT.


### Refresco del frontend

Recomendado:

- 60–120s mínimo.
- Si el mapa refresca demasiado (p.ej. 5–10s) y hay muchos usuarios, puedes generar demasiadas peticiones.

---

## Desarrollo local

### Opción A) Rápida (solo frontend)

- Abre `index.html` con Live Server.
- Si tu `fetch()` usa `/api/traffic`, en local esa ruta no existe salvo que tengas un backend local o emules Pages Functions.


### Opción B) Completa (frontend + Functions)

- La forma correcta es emular Cloudflare Pages + Functions en local (si decides usar tooling local).
- Alternativamente, usa backend local en `localhost:8080` y activa “modo dual” (ver arriba).

---

## Troubleshooting

### `/api/traffic` devuelve 404

- No existe `functions/api/traffic.js` en el repo (o no está en la rama desplegada).
- Revisa que la carpeta se llame exactamente `functions/` y el archivo `traffic.js`.


### `/api/traffic` devuelve 500/502

Causas típicas:

- Fallo temporal del upstream DGT.
- Cambió el formato de respuesta y falla el decode/parse.
- Timeouts.

Qué hacer:

1. Abre directamente `https://TU-PROYECTO.pages.dev/api/traffic`.
2. Copia el error JSON (si lo devuelve) o el status code.
3. Revisa logs en Cloudflare (Functions).

### El mapa no muestra incidencias pero `/api/traffic` funciona

- Revisa consola del navegador (F12) y Network:
    - ¿La llamada a `/api/traffic` devuelve 200?
    - ¿Hay `situationsRecords`?
- Si hay geometrías inválidas, la app puede descartarlas (depende del `try/catch`).


### No se ve el icono de baliza

- Verifica que existe `imgs/flashled-sos-v16.png`.
- Abre en el navegador:
    - `https://TU-PROYECTO.pages.dev/imgs/flashled-sos-v16.png`

---

## Roadmap

- Ajustar posición de baliza al punto medio real del tramo (midpoint por distancia).
- Persistir filtros/zoom en querystring (URLs compartibles).
- Mejorar estilos: leyenda por causa, colores consistentes, modo oscuro.
- Cache más inteligente (ETag / stale-while-revalidate) si fuera necesario.

---

## Licencia


- MIT
- Apache-2.0
- Uso interno / privada
