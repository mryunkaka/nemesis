const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const ROOT_DIR = path.resolve(__dirname, "..");

function resolveFromRoot(value, fallback) {
  const target = value || fallback;
  return path.isAbsolute(target) ? target : path.join(ROOT_DIR, target);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "ya", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "tidak", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseInteger(value, fallback, minimum = null, maximum = null) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (minimum !== null && parsed < minimum) {
    return minimum;
  }

  if (maximum !== null && parsed > maximum) {
    return maximum;
  }

  return parsed;
}

const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

const DATA_DIR = resolveFromRoot(process.env.DATA_DIR, "data");
const DATASET_DIR = resolveFromRoot(process.env.AUDIT_DATASET_DIR, "dataset");
const GEO_ROOT_PATH = resolveFromRoot(process.env.GEO_ROOT_PATH, path.join("seed", "geo"));
const LIVE_SYNC_DIR = resolveFromRoot(process.env.LIVE_SYNC_DIR, path.join("data", "live-sync"));
const AUTO_REFRESH_SOURCE_MODE = String(process.env.AUTO_REFRESH_SOURCE_MODE || "none").trim().toLowerCase();

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DATASET_DIR,
  GEO_ROOT_PATH,
  LIVE_SYNC_DIR,
  PORT: port,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  DB_PATH: resolveFromRoot(process.env.SQLITE_PATH, path.join("data", "dashboard.sqlite")),
  GEOJSON_PATH: resolveFromRoot(process.env.GEOJSON_PATH, path.join(GEO_ROOT_PATH, "03-districts")),
  PROVINCE_GEOJSON_PATH: resolveFromRoot(
    process.env.PROVINCE_GEOJSON_PATH,
    path.join(GEO_ROOT_PATH, "02-provinces", "province-only")
  ),
  AUDIT_DATASET_DIR: DATASET_DIR,
  AUDIT_DATASET_YEAR: String(process.env.AUDIT_DATASET_YEAR || "2026").trim(),
  DEFAULT_REGION_PAGE_SIZE: 25,
  MAX_REGION_PAGE_SIZE: 100,
  AUTO_REFRESH_ENABLED: parseBoolean(process.env.AUTO_REFRESH_ENABLED, false),
  AUTO_REFRESH_RUN_ON_STARTUP: parseBoolean(process.env.AUTO_REFRESH_RUN_ON_STARTUP, false),
  AUTO_REFRESH_HOUR: parseInteger(process.env.AUTO_REFRESH_HOUR, 1, 0, 23),
  AUTO_REFRESH_MINUTE: parseInteger(process.env.AUTO_REFRESH_MINUTE, 0, 0, 59),
  AUTO_REFRESH_TIMEZONE: String(process.env.AUTO_REFRESH_TIMEZONE || "Asia/Jakarta").trim(),
  AUTO_REFRESH_SOURCE_MODE,
  AUTO_REFRESH_SOURCE_URLS: String(process.env.AUTO_REFRESH_SOURCE_URLS || "").trim(),
  AUTO_REFRESH_HEADERS_JSON: String(process.env.AUTO_REFRESH_HEADERS_JSON || "").trim(),
  AUTO_REFRESH_TIMEOUT_MS: parseInteger(process.env.AUTO_REFRESH_TIMEOUT_MS, 300000, 1000),
  AUTO_REFRESH_CLEAN_DATASET_DIR: parseBoolean(process.env.AUTO_REFRESH_CLEAN_DATASET_DIR, false),
  AUTO_REFRESH_COMMAND: String(process.env.AUTO_REFRESH_COMMAND || "").trim(),
  AUTO_REFRESH_SYNC_CODES: String(process.env.AUTO_REFRESH_SYNC_CODES || "").trim(),
  AUTO_REFRESH_ADMIN_TOKEN: String(process.env.AUTO_REFRESH_ADMIN_TOKEN || "").trim(),
  AUTO_REFRESH_ALLOW_MANUAL_TRIGGER: parseBoolean(process.env.AUTO_REFRESH_ALLOW_MANUAL_TRIGGER, true),
  INAPROC_BROWSER_MODE: String(process.env.INAPROC_BROWSER_MODE || "real").trim().toLowerCase(),
  INAPROC_BROWSER_USE_KERNEL: parseBoolean(process.env.INAPROC_BROWSER_USE_KERNEL, false),
};
