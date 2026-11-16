// StockDesk: tiny stock-tracking API. Node.js 18+, no dependency.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { checkDatabase } = require("./db");

const config = {
  port: Number(process.env.PORT || 3000),
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: Number(process.env.DB_PORT || 5432),
  dbUser: process.env.DB_USER || "stockdesk",
  dbPassword: process.env.DB_PASSWORD || "",
  apiKey: process.env.API_KEY || "",
};

// A request body for "adjust" is a tiny JSON object; refuse anything bigger.
const MAX_BODY_BYTES = 10 * 1024;

// Seeded in-memory data (the real application would read it from PostgreSQL).
const products = [
  { sku: "BOLT-M6", name: "Hex bolt M6", stock: 1200 },
  { sku: "NUT-M6", name: "Hex nut M6", stock: 950 },
  { sku: "WASH-M6", name: "Flat washer M6", stock: 40 },
  { sku: "DRILL-18V", name: "Cordless drill 18V", stock: 12 },
  { sku: "GLOVE-L", name: "Work gloves, size L", stock: 75 },
];

// What is safe to write in a log: never the password or the API key themselves.
function redactedConfig(c) {
  return {
    port: c.port,
    dbHost: c.dbHost,
    dbPort: c.dbPort,
    dbUser: c.dbUser,
    dbPasswordSet: Boolean(c.dbPassword),
    apiKeySet: Boolean(c.apiKey),
  };
}

// Constant-time comparison (hashing first gives both sides the same length).
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    // Liveness: "the process is up". Deliberately does NOT look at the database,
    // so a database outage does not make Kubernetes restart every pod.
    if (req.method === "GET" && url.pathname === "/livez") return send(res, 200, { status: "alive" });

    // Readiness / health: also checks the database.
    if (req.method === "GET" && url.pathname === "/health") {
      const dbOk = await checkDatabase(config.dbHost, config.dbPort);
      return dbOk ? send(res, 200, { status: "ok", database: "up" }) : send(res, 503, { status: "degraded", database: "down" });
    }

    if (req.method === "GET" && url.pathname === "/api/products") return send(res, 200, products);

    const m = url.pathname.match(/^\/api\/products\/([A-Z0-9-]+)\/adjust$/);
    if (req.method === "POST" && m) {
      const provided = req.headers["x-api-key"];
      if (!config.apiKey || typeof provided !== "string" || !safeEqual(provided, config.apiKey)) {
        return send(res, 401, { error: "Missing or invalid API key" });
      }
      const product = products.find((p) => p.sku === m[1]);
      if (!product) return send(res, 404, { error: "Unknown SKU" });
      let raw = "";
      let size = 0;
      let tooLarge = false;
      req.on("data", (c) => {
        if (tooLarge) return; // keep draining, store nothing
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          raw = "";
          res.setHeader("Connection", "close");
          return send(res, 413, { error: "Payload too large" });
        }
        raw += c;
      });
      req.on("end", () => {
        if (tooLarge) return;
        let body;
        try { body = JSON.parse(raw || "{}"); } catch { return send(res, 400, { error: "Invalid JSON" }); }
        if (!Number.isInteger(body.delta)) return send(res, 400, { error: "delta must be an integer" });
        if (product.stock + body.delta < 0) return send(res, 409, { error: "Stock cannot go below zero" });
        product.stock += body.delta;
        send(res, 200, product);
      });
      return;
    }

    send(res, 404, { error: "Not found" });
  });
  // Slow-client protection (Node's defaults are much more generous).
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return server;
}

function start() {
  // Startup trace: configuration WITHOUT secrets.
  console.log("StockDesk starting with config:", JSON.stringify(redactedConfig(config)));
  // Small marker file written at startup (used by the support team to see the last restart time).
  // Best effort only: on a read-only filesystem this must not stop the service.
  try {
    fs.writeFileSync(path.join(os.tmpdir(), "stockdesk-started.txt"), new Date().toISOString());
  } catch (err) {
    console.warn("Could not write the startup marker file:", err.code || err.message);
  }
  const server = createServer();
  server.listen(config.port, () => console.log("StockDesk listening on port " + config.port));

  // Node as PID 1 ignores SIGTERM by default: stop cleanly so rollouts are fast.
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      console.log("Received " + sig + ", shutting down");
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
  return server;
}

if (require.main === module) start();

module.exports = { createServer, config, products, redactedConfig };
