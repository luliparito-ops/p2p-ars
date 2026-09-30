// Requiere Node 18+. Uso: node server.js  ->  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const BINANCE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const FIATS = ["ARS", "BOB"];
const TTL = 3000; // caché de 3 s por consulta, para no saturar a Binance
const cache = new Map(); // key -> { t, promise }

async function fetchAds({ fiat, tradeType, amount, payType, merchants, rows }) {
  const body = {
    fiat,
    asset: "USDT",
    tradeType, // BUY = vos comprás USDT (anuncios de venta) | SELL = vos vendés USDT
    page: 1,
    rows,
    countries: [],
    publisherType: merchants ? "merchant" : null,
    payTypes: payType ? [payType] : [],
    transAmount: amount || "",
    proMerchantAds: false,
    shieldMerchantAds: false,
    classifies: ["mass", "profession"],
  };
  const res = await fetch(BINANCE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("Binance respondió " + res.status);
  const json = await res.json();
  if (json.code && json.code !== "000000") {
    throw new Error(json.message || "Binance devolvió el código " + json.code);
  }
  return (json.data || []).map(({ adv, advertiser }) => ({
    price: Number(adv.price),
    available: Number(adv.tradableQuantity),
    min: Number(adv.minSingleTransAmount),
    max: Number(adv.dynamicMaxSingleTransAmount || adv.maxSingleTransAmount),
    methods: (adv.tradeMethods || []).map((m) => m.tradeMethodName || m.identifier),
    nick: advertiser.nickName,
    orders: advertiser.monthOrderCount,
    rate: advertiser.monthFinishRate,
    merchant: advertiser.userType === "merchant",
  }));
}

// Cachea la promesa: consultas idénticas simultáneas comparten una sola llamada a Binance.
function getAds(params) {
  const key = [params.fiat, params.tradeType, params.amount, params.payType, params.merchants, params.rows].join("|");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < TTL) return hit.promise;

  for (const [k, v] of cache) if (now - v.t >= TTL) cache.delete(k); // evita que el caché crezca sin límite

  const promise = fetchAds(params).catch((e) => {
    if (cache.get(key)?.promise === promise) cache.delete(key); // no cachear errores
    throw e;
  });
  cache.set(key, { t: now, promise });
  return promise;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (url.pathname === "/api/ads") {
      const json = { "Content-Type": "application/json", ...corsHeaders };
      try {
        const q = url.searchParams;
        const fiat = (q.get("fiat") || "ARS").toUpperCase();
        if (!FIATS.includes(fiat)) {
          res.writeHead(400, json);
          res.end(JSON.stringify({ error: "Moneda no soportada: " + fiat }));
          return;
        }
        const data = await getAds({
          fiat,
          tradeType: q.get("tradeType") === "SELL" ? "SELL" : "BUY",
          amount: (q.get("amount") || "").replace(/[^\d.]/g, ""),
          payType: (q.get("payType") || "").replace(/[^\w]/g, ""),
          merchants: q.get("merchants") === "1",
          rows: Math.min(Number(q.get("rows")) || 10, 20),
        });
        res.writeHead(200, json);
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(502, json);
        res.end(JSON.stringify({ error: e.name === "TimeoutError" ? "Binance tardó demasiado en responder" : e.message }));
      }
      return;
    }
    fs.readFile(path.join(__dirname, "index.html"), (err, html) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Falta index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
  })
  .listen(PORT, () => console.log(`Listo en http://localhost:${PORT}`));
