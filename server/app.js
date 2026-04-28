const path = require("path");
const express = require("express");
const cors = require("cors");
const { CORS_ORIGIN } = require("./config");
const { getBootstrapPayload, getOwnerPackages, getRegionPackages, getProvincePackages } = require("./dashboard-repository");

function resolveCorsOrigin() {
  if (CORS_ORIGIN === "*") {
    return "*";
  }

  return CORS_ORIGIN.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return String(req.query.token || req.headers["x-admin-token"] || "").trim();
}

function createApp(db, options = {}) {
  const dataRefreshService = options.dataRefreshService || null;
  const app = express();

  app.use(
    cors({
      origin: resolveCorsOrigin(),
    })
  );
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/bootstrap", (_req, res) => {
    res.json(getBootstrapPayload(db));
  });

  app.get("/api/regions/:regionKey/packages", (req, res) => {
    const payload = getRegionPackages(db, req.params.regionKey, req.query);

    if (!payload) {
      res.status(404).json({ error: "Region not found" });
      return;
    }

    res.json(payload);
  });

  app.get("/api/provinces/:provinceKey/packages", (req, res) => {
    const payload = getProvincePackages(db, req.params.provinceKey, req.query);

    if (!payload) {
      res.status(404).json({ error: "Province not found" });
      return;
    }

    res.json(payload);
  });

  app.get("/api/owners/packages", (req, res) => {
    const ownerType = (req.query.ownerType || "").trim();
    const ownerName = (req.query.ownerName || "").trim();

    if (!ownerType || !ownerName) {
      res.status(400).json({ error: "ownerType and ownerName are required" });
      return;
    }

    const payload = getOwnerPackages(db, req.query);

    if (!payload) {
      res.status(404).json({ error: "Owner not found" });
      return;
    }

    res.json(payload);
  });

  app.get("/api/admin/refresh/status", (req, res) => {
    if (!dataRefreshService) {
      res.status(404).json({ error: "Refresh service is not available" });
      return;
    }

    if (dataRefreshService.hasAdminToken() && !dataRefreshService.isAuthorized(extractBearerToken(req))) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.json(dataRefreshService.getStatus());
  });

  app.post("/api/admin/refresh", async (req, res) => {
    if (!dataRefreshService) {
      res.status(404).json({ error: "Refresh service is not available" });
      return;
    }

    if (!dataRefreshService.canTriggerManually()) {
      res.status(403).json({ error: "Manual refresh is disabled" });
      return;
    }

    if (dataRefreshService.hasAdminToken() && !dataRefreshService.isAuthorized(extractBearerToken(req))) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const payload = await dataRefreshService.run("manual-api");
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        status: dataRefreshService.getStatus(),
      });
    }
  });

  app.get("/api/admin/refresh/run", async (req, res) => {
    if (!dataRefreshService) {
      res.status(404).json({ error: "Refresh service is not available" });
      return;
    }

    if (!dataRefreshService.canTriggerManually()) {
      res.status(403).json({ error: "Manual refresh is disabled" });
      return;
    }

    if (dataRefreshService.hasAdminToken() && !dataRefreshService.isAuthorized(extractBearerToken(req))) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const payload = await dataRefreshService.run("manual-browser");
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        status: dataRefreshService.getStatus(),
      });
    }
  });

  // Serve static files from public folder
  const publicPath = path.resolve(__dirname, "..", "public");
  app.use(express.static(publicPath));

  // Specific route for /algoritma
  app.get("/algoritma", (_req, res) => {
    res.sendFile(path.join(publicPath, "algoritma.html"));
  });

  // SPA fallback - serve index.html for non-API routes (exclude specific files)
  app.get(/^(?!\/api|.*\.html$|.*\.css$|.*\.js$|.*\.png$|.*\.jpg$|.*\.svg$).*/, (_req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = {
  createApp,
};
