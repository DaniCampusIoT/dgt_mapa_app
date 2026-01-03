export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeaders(context.request) });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  if (url.pathname.endsWith("/health")) {
    return json({ status: "healthy", time: new Date().toISOString() }, 200, corsHeaders(context.request));
  }

  // Cache en edge para no golpear DGT por cada usuario
  const cacheTtl = 30; // segundos (ajústalo)
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, context.request);

  const payload = {
    filtrosVia: ["Carreteras cortadas","Tráfico lento","Circulación restringida","Desvíos y embolsamientos","Otras vialidades"],
    filtrosCausa: ["Obras","Accidente","Meteorológicos","Restricciones de circulación","Otras incidencias"]
  };

  // POST a DGT (Workers/Pages Functions soportan fetch a APIs externas) [web:409][web:406]
  const dgtResp = await fetch("https://etraffic.dgt.es/etrafficWEB/api/cache/getFilteredData", {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "origin": "https://etraffic.dgt.es",
      "referer": "https://etraffic.dgt.es/etrafficWEB/",
      "accept-language": "es-ES,es;q=0.9"
    },
    body: JSON.stringify(payload)
  });

  if (!dgtResp.ok) {
    return json({ error: "Failed to fetch from DGT", status: dgtResp.status }, 502, corsHeaders(context.request));
  }

  // Respuesta viene como base64 y luego XOR 'K' (según tu backend Go)
  const b64 = (await dgtResp.text()).trim();

  let decodedBytes;
  try {
    decodedBytes = xorDecodeBase64(b64, "K");
  } catch (e) {
    return json({ error: "Decode failed", details: String(e) }, 500, corsHeaders(context.request));
  }

  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(decodedBytes));
  } catch (e) {
    return json({ error: "JSON parse failed", details: String(e) }, 500, corsHeaders(context.request));
  }

  const resp = json(obj, 200, {
    ...corsHeaders(context.request),
    "Cache-Control": `public, max-age=0, s-maxage=${cacheTtl}`
  });

  context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// Helpers
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function corsHeaders(request) {
  // Si sirves todo desde Pages (mismo dominio), CORS no es necesario,
  // pero lo dejamos por si pruebas desde localhost.
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,Cache-Control,Pragma,Accept-Language",
    "Access-Control-Max-Age": "86400"
  };
}

function withCors(response, request) {
  const h = new Headers(response.headers);
  const origin = request.headers.get("Origin") || "*";
  h.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, { status: response.status, headers: h });
}

function xorDecodeBase64(b64, keyChar) {
  const bin = atob(b64);
  const key = keyChar.charCodeAt(0);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) ^ key;
  return out;
}
