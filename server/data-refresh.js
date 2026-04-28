const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { exec } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const {
  AUDIT_DATASET_DIR,
  AUDIT_DATASET_YEAR,
  AUTO_REFRESH_ADMIN_TOKEN,
  AUTO_REFRESH_ALLOW_MANUAL_TRIGGER,
  AUTO_REFRESH_CLEAN_DATASET_DIR,
  AUTO_REFRESH_COMMAND,
  AUTO_REFRESH_ENABLED,
  AUTO_REFRESH_HEADERS_JSON,
  AUTO_REFRESH_HOUR,
  AUTO_REFRESH_MINUTE,
  AUTO_REFRESH_RUN_ON_STARTUP,
  AUTO_REFRESH_SOURCE_MODE,
  AUTO_REFRESH_SOURCE_URLS,
  AUTO_REFRESH_TIMEOUT_MS,
  AUTO_REFRESH_TIMEZONE,
} = require("./config");
const { createSchema, seedDatabase } = require("./seed");

const execAsync = promisify(exec);
const SCHEDULER_TICK_MS = 30 * 1000;

function parseHeaders() {
  if (!AUTO_REFRESH_HEADERS_JSON) {
    return {};
  }

  try {
    const parsed = JSON.parse(AUTO_REFRESH_HEADERS_JSON);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    throw new Error(`AUTO_REFRESH_HEADERS_JSON is invalid JSON: ${error.message}`);
  }
}

function parseSourceUrls() {
  return AUTO_REFRESH_SOURCE_URLS.split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\{year\}/g, AUDIT_DATASET_YEAR));
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function safeUnlink(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {}
}

function datasetFileNameFromUrl(url, index) {
  try {
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname);
    if (baseName && baseName !== "/") {
      return baseName;
    }
  } catch {}

  return `year-${AUDIT_DATASET_YEAR}.part-${String(index + 1).padStart(5, "0")}.csv`;
}

function cleanDatasetParts(datasetDir) {
  const prefix = `year-${AUDIT_DATASET_YEAR}.part-`;

  for (const entry of fs.readdirSync(datasetDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.startsWith(prefix)) {
      continue;
    }

    if (!/\.(csv|jsonl)$/i.test(entry.name)) {
      continue;
    }

    safeUnlink(path.join(datasetDir, entry.name));
  }
}

async function downloadFile(url, destinationPath, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTO_REFRESH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const body = response.body;

    if (!body) {
      throw new Error("Response body is empty.");
    }

    await pipeline(Readable.fromWeb(body), fs.createWriteStream(destinationPath));
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshDatasetFromHttp() {
  const urls = parseSourceUrls();

  if (!urls.length) {
    throw new Error("AUTO_REFRESH_SOURCE_URLS is empty.");
  }

  ensureDirectory(AUDIT_DATASET_DIR);
  const headers = parseHeaders();
  const stagingDir = path.join(AUDIT_DATASET_DIR, `.incoming-${Date.now()}`);
  ensureDirectory(stagingDir);

  try {
    const downloadedFiles = [];

    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      const fileName = datasetFileNameFromUrl(url, index);
      const targetPath = path.join(stagingDir, fileName);

      await downloadFile(url, targetPath, headers);
      downloadedFiles.push({
        url,
        fileName,
        targetPath,
      });
    }

    if (AUTO_REFRESH_CLEAN_DATASET_DIR) {
      cleanDatasetParts(AUDIT_DATASET_DIR);
    }

    for (const file of downloadedFiles) {
      const finalPath = path.join(AUDIT_DATASET_DIR, file.fileName);
      safeUnlink(finalPath);
      fs.renameSync(file.targetPath, finalPath);
    }

    return {
      mode: "http",
      downloadedFiles: downloadedFiles.map((file) => ({
        url: file.url,
        fileName: file.fileName,
      })),
    };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function refreshDatasetFromCommand() {
  if (!AUTO_REFRESH_COMMAND) {
    throw new Error("AUTO_REFRESH_COMMAND is empty.");
  }

  const { stdout, stderr } = await execAsync(AUTO_REFRESH_COMMAND, {
    cwd: path.resolve(__dirname, ".."),
    timeout: AUTO_REFRESH_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      AUDIT_DATASET_DIR,
      AUDIT_DATASET_YEAR,
    },
  });

  return {
    mode: "command",
    stdout: String(stdout || "").trim(),
    stderr: String(stderr || "").trim(),
  };
}

async function refreshDatasetSource() {
  if (AUTO_REFRESH_SOURCE_MODE === "none") {
    return {
      mode: "none",
      skipped: true,
    };
  }

  if (AUTO_REFRESH_SOURCE_MODE === "http") {
    return refreshDatasetFromHttp();
  }

  if (AUTO_REFRESH_SOURCE_MODE === "command") {
    return refreshDatasetFromCommand();
  }

  throw new Error(`Unsupported AUTO_REFRESH_SOURCE_MODE "${AUTO_REFRESH_SOURCE_MODE}".`);
}

function getNowParts(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

class DataRefreshService {
  constructor(db) {
    this.db = db;
    this.running = false;
    this.timer = null;
    this.lastRunStartedAt = null;
    this.lastRunFinishedAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.lastResult = null;
    this.lastScheduleDateKey = null;
  }

  isEnabled() {
    return AUTO_REFRESH_ENABLED;
  }

  canTriggerManually() {
    return AUTO_REFRESH_ALLOW_MANUAL_TRIGGER;
  }

  hasAdminToken() {
    return Boolean(AUTO_REFRESH_ADMIN_TOKEN);
  }

  isAuthorized(token) {
    return Boolean(AUTO_REFRESH_ADMIN_TOKEN) && token === AUTO_REFRESH_ADMIN_TOKEN;
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      running: this.running,
      sourceMode: AUTO_REFRESH_SOURCE_MODE,
      datasetDir: AUDIT_DATASET_DIR,
      datasetYear: AUDIT_DATASET_YEAR,
      schedule: {
        hour: AUTO_REFRESH_HOUR,
        minute: AUTO_REFRESH_MINUTE,
        timeZone: AUTO_REFRESH_TIMEZONE,
      },
      lastRunStartedAt: this.lastRunStartedAt,
      lastRunFinishedAt: this.lastRunFinishedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }

  async run(reason = "manual") {
    if (this.running) {
      return {
        skipped: true,
        reason: "already-running",
        status: this.getStatus(),
      };
    }

    this.running = true;
    this.lastError = null;
    this.lastRunStartedAt = new Date().toISOString();

    try {
      const fetchResult = await refreshDatasetSource();
      createSchema(this.db);
      const seedSummary = seedDatabase(this.db);

      this.lastRunFinishedAt = new Date().toISOString();
      this.lastSuccessAt = this.lastRunFinishedAt;
      this.lastResult = {
        reason,
        fetchResult,
        seedSummary,
      };

      return {
        ok: true,
        ...this.lastResult,
      };
    } catch (error) {
      this.lastRunFinishedAt = new Date().toISOString();
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.isEnabled()) {
      return;
    }

    if (AUTO_REFRESH_RUN_ON_STARTUP) {
      this.run("startup").catch((error) => {
        console.error(`Initial auto-refresh failed: ${error.message}`);
      });
    }

    this.timer = setInterval(() => {
      const now = getNowParts(AUTO_REFRESH_TIMEZONE);
      const shouldRun =
        now.hour === AUTO_REFRESH_HOUR &&
        now.minute === AUTO_REFRESH_MINUTE &&
        this.lastScheduleDateKey !== now.dateKey;

      if (!shouldRun) {
        return;
      }

      this.lastScheduleDateKey = now.dateKey;
      this.run("schedule").catch((error) => {
        console.error(`Scheduled auto-refresh failed: ${error.message}`);
      });
    }, SCHEDULER_TICK_MS);

    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function createDataRefreshService(db) {
  return new DataRefreshService(db);
}

module.exports = {
  createDataRefreshService,
};
