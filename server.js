// Requiere Node 18+. Uso: node server.js  ->  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const BINANCE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const cache = new Map(); // evita saturar a Binance: 3 s de caché por consulta

async function getAds({ tradeType, amount, payType, merchants, rows }) {
  const key = [tradeType, amount, payType, merchants, rows].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 3000) return hit.data;

  const body = {
    fiat: "ARS",
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
  });
  if (!res.ok) throw new Error("Binance respondió " + res.status);
  const json = await res.json();
  const data = (json.data || []).map(({ adv, advertiser }) => ({
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
  cache.set(key, { t: Date.now(), data });
  return data;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/ads") {
      try {
        const q = url.searchParams;
        const data = await getAds({
          tradeType: q.get("tradeType") === "SELL" ? "SELL" : "BUY",
          amount: (q.get("amount") || "").replace(/[^\d.]/g, ""),
          payType: (q.get("payType") || "").replace(/[^\w]/g, ""),
          merchants: q.get("merchants") === "1",
          rows: Math.min(Number(q.get("rows")) || 10, 20),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    fs.readFile(path.join(__dirname, "index.html"), (err, html) => {
      if (err) return res.writeHead(500).end("Falta index.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
  })
  .listen(PORT, () => console.log(`Listo en http://localhost:${PORT}`));
