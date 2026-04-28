const fs = require("fs");
const path = require("path");
const { StringDecoder } = require("string_decoder");
const { AUDIT_DATASET_YEAR, LIVE_SYNC_DIR } = require("./config");

const JSONL_READ_BUFFER_SIZE = 256 * 1024;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureLiveSyncDirectory() {
  fs.mkdirSync(LIVE_SYNC_DIR, { recursive: true });
}

function listLiveSyncFiles(extension) {
  if (!fs.existsSync(LIVE_SYNC_DIR)) {
    return [];
  }

  const year = String(AUDIT_DATASET_YEAR || "").trim();
  const matcher = new RegExp(`^year-${escapeRegExp(year)}\\.sync-(\\d{5})\\.${extension}$`, "i");

  return fs
    .readdirSync(LIVE_SYNC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(matcher);

      if (!match) {
        return null;
      }

      return {
        partNumber: Number.parseInt(match[1], 10),
        filePath: path.resolve(LIVE_SYNC_DIR, entry.name),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.partNumber - right.partNumber)
    .map((entry) => entry.filePath);
}

function appendJsonlRecord(filePath, record) {
  ensureLiveSyncDirectory();
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function nextLiveSyncFilePath() {
  ensureLiveSyncDirectory();
  const files = listLiveSyncFiles("jsonl");
  const nextPart = files.length + 1;

  return path.join(
    LIVE_SYNC_DIR,
    `year-${AUDIT_DATASET_YEAR}.sync-${String(nextPart).padStart(5, "0")}.jsonl`
  );
}

function forEachJsonlRow(filePath, onRow) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(JSONL_READ_BUFFER_SIZE);
  const decoder = new StringDecoder("utf8");
  let lineNumber = 0;
  let pending = "";

  const processLine = (rawLine) => {
    lineNumber += 1;

    let line = rawLine;
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }

    line = line.trim();
    if (!line) {
      return;
    }

    onRow(JSON.parse(line));
  };

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);

      if (!bytesRead) {
        break;
      }

      const chunk = pending + decoder.write(buffer.subarray(0, bytesRead));
      const lines = chunk.split("\n");
      pending = lines.pop() || "";

      for (const rawLine of lines) {
        processLine(rawLine);
      }
    }

    const rest = pending + decoder.end();
    if (rest) {
      processLine(rest);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function collectLiveSyncIds() {
  const ids = new Set();

  for (const filePath of listLiveSyncFiles("jsonl")) {
    forEachJsonlRow(filePath, (row) => {
      const value = row && (row.id ?? row.source_id ?? row.sourceId);

      if (value !== null && value !== undefined && value !== "") {
        ids.add(String(value).trim());
      }
    });
  }

  return ids;
}

module.exports = {
  LIVE_SYNC_DIR,
  appendJsonlRecord,
  collectLiveSyncIds,
  ensureLiveSyncDirectory,
  listLiveSyncFiles,
  nextLiveSyncFilePath,
};
