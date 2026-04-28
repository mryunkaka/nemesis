const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");
const {
  AUDIT_DATASET_DIR,
  AUDIT_DATASET_YEAR,
  DATA_DIR,
  INAPROC_BROWSER_MODE,
  INAPROC_BROWSER_USE_KERNEL,
} = require("../server/config");

const execFileAsync = promisify(execFile);
const RAW_OUTPUT_DIR = path.join(DATA_DIR, "live-sync-raw");
const CSV_HEADERS = [
  "paket",
  "dalamNegeri",
  "jenisPengadaan",
  "metode",
  "lembaga",
  "satker",
  "lokasi",
  "id",
  "pagu",
  "pemilihanDate",
  "sumberDana",
  "isUMKM",
  "volumePekerjaan",
  "uraianPekerjaan",
  "spesifikasiPekerjaan",
  "ownerType",
  "potensiPemborosan",
  "tags.isInappropriate",
  "tags.inappropriateReason",
  "jumlahTagAktif",
];

function getFlagValue(args, flagName) {
  const index = args.indexOf(flagName);
  return index === -1 ? "" : String(args[index + 1] || "").trim();
}

function parseCodes(args) {
  return getFlagValue(args, "--codes")
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveDatasetDir(args) {
  const raw = getFlagValue(args, "--dataset-dir");

  if (!raw) {
    return AUDIT_DATASET_DIR;
  }

  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

function findLastPartNumber(datasetDir) {
  if (!fs.existsSync(datasetDir)) {
    return 0;
  }

  let maxPart = 0;

  for (const fileName of fs.readdirSync(datasetDir)) {
    const match = fileName.match(new RegExp(`^year-${AUDIT_DATASET_YEAR}\\.part-(\\d{5})(?:\\.csv|_failures\\.csv|_priority\\.json)$`, "i"));
    if (!match) {
      continue;
    }

    const currentPart = Number.parseInt(match[1], 10);
    if (Number.isFinite(currentPart) && currentPart > maxPart) {
      maxPart = currentPart;
    }
  }

  return maxPart;
}

function findNextPart(datasetDir) {
  const lastPart = findLastPartNumber(datasetDir);
  return String(lastPart + 1).padStart(5, "0");
}

function formatPartNumber(value) {
  return String(value).padStart(5, "0");
}

function resolvePart(args, datasetDir) {
  const raw = getFlagValue(args, "--part");

  if (!raw) {
    return findNextPart(datasetDir);
  }

  const normalized = raw.padStart(5, "0");
  if (!/^\d{5}$/.test(normalized)) {
    throw new Error(`Invalid part "${raw}". Use 5 digits like 00002.`);
  }

  return normalized;
}

function parseForce(args) {
  return args.includes("--force");
}

function parseFromFailures(args) {
  return args.includes("--from-failures");
}

async function runBrowserAct(args) {
  const { stdout } = await execFileAsync("browser-act", args, {
    cwd: path.resolve(__dirname, ".."),
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });

  return JSON.parse(String(stdout).trim());
}

function extractExistingRealSessionName(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const match = message.match(/Real Chrome is already running in session '([^']+)'/i);
  return match ? match[1] : "";
}

function resolveInitialSessionName(code) {
  return INAPROC_BROWSER_MODE === "real" ? "inaproc-sync-real" : `inaproc-sync-${code}`;
}

function stripHtmlTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTableFields(html) {
  const rows = [...String(html || "").matchAll(/<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi)];
  const fields = {};

  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => decodeHtmlEntities(stripHtmlTags(match[1])))
      .filter(Boolean);

    if (cells.length >= 2) {
      fields[cells[0].toLowerCase()] = cells[1];
    }
  }

  return fields;
}

function findObjectWithCode(value, code) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectWithCode(item, code);
      if (found) {
        return found;
      }
    }

    return null;
  }

  if (String(value.kode ?? value.id ?? value.koderup ?? "").trim() === code) {
    return value;
  }

  for (const nested of Object.values(value)) {
    const found = findObjectWithCode(nested, code);
    if (found) {
      return found;
    }
  }

  return null;
}

function extractNextDataRecord(html, code) {
  const scripts = [...String(html || "").matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    const raw = String(script[1] || "").trim();

    if (!raw.startsWith("{") || !raw.includes(String(code))) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      const found = findObjectWithCode(parsed, String(code));
      if (found) {
        return found;
      }
    } catch {}
  }

  return null;
}

function inferOwnerType(ownerName) {
  const normalized = String(ownerName || "").trim().toLowerCase();

  if (
    normalized.startsWith("kab.") ||
    normalized.startsWith("kabupaten") ||
    normalized.startsWith("kota") ||
    normalized.startsWith("pemkab") ||
    normalized.startsWith("pemkot")
  ) {
    return "kabkota";
  }

  if (normalized.startsWith("provinsi") || normalized.startsWith("pemprov")) {
    return "provinsi";
  }

  return "central";
}

function toDatasetRecord(code, fields = {}, rawRecord = null) {
  const packageName =
    rawRecord?.namaPaket ||
    rawRecord?.paket ||
    rawRecord?.nama ||
    fields["nama paket"] ||
    fields.paket ||
    `Paket ${code}`;
  const ownerName =
    rawRecord?.namaSatkerParent ||
    rawRecord?.lembaga ||
    rawRecord?.namaKldi ||
    fields.lembaga ||
    fields["nama lembaga"] ||
    "Tanpa lembaga";
  const satker = rawRecord?.satker || rawRecord?.namaSatker || fields.satker || "";
  const location = rawRecord?.lokasi || fields.lokasi || fields["lokasi paket"] || "";
  const budget =
    rawRecord?.pagu ??
    rawRecord?.nilaiPagu ??
    rawRecord?.nilai ??
    fields.pagu ??
    fields["nilai pagu"] ??
    0;
  const procurementType =
    rawRecord?.jenisPengadaan || fields["jenis pengadaan"] || fields.jenis || "Barang";
  const method = rawRecord?.metode || fields.metode || "";
  const fundingSource = rawRecord?.sumberDana || fields["sumber dana"] || "";
  const selectionDate =
    rawRecord?.pemilihanDate ||
    rawRecord?.jadwalPemilihan ||
    fields["jadwal pemilihan"] ||
    fields.pemilihan ||
    "";
  const volume = rawRecord?.volumePekerjaan || fields["volume pekerjaan"] || "";
  const workDescription = rawRecord?.uraianPekerjaan || fields["uraian pekerjaan"] || "";
  const specification = rawRecord?.spesifikasiPekerjaan || fields["spesifikasi pekerjaan"] || "";

  return {
    paket: String(packageName || "").trim(),
    dalamNegeri: "True",
    jenisPengadaan: String(procurementType || "").trim(),
    metode: String(method || "").trim(),
    lembaga: String(ownerName || "").trim(),
    satker: String(satker || "").trim(),
    lokasi: String(location || "").trim(),
    id: Number(code),
    pagu: Number(String(budget || "0").replace(/[^\d.-]/g, "")) || 0,
    pemilihanDate: String(selectionDate || "").trim(),
    sumberDana: String(fundingSource || "").trim(),
    isUMKM: "True",
    volumePekerjaan: String(volume || "").trim(),
    uraianPekerjaan: String(workDescription || "").trim(),
    spesifikasiPekerjaan: String(specification || "").trim(),
    ownerType: inferOwnerType(ownerName),
    potensiPemborosan: 0,
    "tags.isInappropriate": "low",
    "tags.inappropriateReason": "",
    jumlahTagAktif: 0,
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsvRow(record) {
  return CSV_HEADERS.map((header) => escapeCsv(record[header])).join(",");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character !== "\r") {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0];

  return rows
    .slice(1)
    .filter((currentRow) => currentRow.some((value) => value !== ""))
    .map((currentRow) => {
      const record = {};

      headers.forEach((header, columnIndex) => {
        record[header] = currentRow[columnIndex] ?? "";
      });

      return record;
    });
}

function readFailureCodes(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return parseCsv(fs.readFileSync(filePath, "utf8"))
    .map((row) => String(row.id || "").trim())
    .filter(Boolean);
}

function resolveSourceFailureCodes(args, datasetDir, part, explicitCodes, fromFailures) {
  if (explicitCodes.length) {
    return {
      codeSource: "explicit",
      sourceFailuresPath: null,
      codes: explicitCodes,
    };
  }

  if (!fromFailures && getFlagValue(args, "--codes")) {
    return {
      codeSource: "none",
      sourceFailuresPath: null,
      codes: [],
    };
  }

  const currentFailuresPath = path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}_failures.csv`);
  const currentFailureCodes = readFailureCodes(currentFailuresPath);

  if (currentFailureCodes.length) {
    return {
      codeSource: "current-part-failures",
      sourceFailuresPath: currentFailuresPath,
      codes: currentFailureCodes,
    };
  }

  const previousPartNumber = Number.parseInt(part, 10) - 1;
  if (previousPartNumber > 0) {
    const previousPart = formatPartNumber(previousPartNumber);
    const previousFailuresPath = path.join(
      datasetDir,
      `year-${AUDIT_DATASET_YEAR}.part-${previousPart}_failures.csv`
    );
    const previousFailureCodes = readFailureCodes(previousFailuresPath);

    if (previousFailureCodes.length) {
      return {
        codeSource: "previous-part-failures",
        sourceFailuresPath: previousFailuresPath,
        codes: previousFailureCodes,
      };
    }
  }

  return {
    codeSource: "none",
    sourceFailuresPath: currentFailuresPath,
    codes: [],
  };
}

function readExistingFailureRows(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function readExistingCsvRecords(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function readExistingPriorityRows(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readExistingCsvIds(datasetDir) {
  const ids = new Set();

  if (!fs.existsSync(datasetDir)) {
    return ids;
  }

  for (const fileName of fs.readdirSync(datasetDir)) {
    if (!/^year-\d{4}\.part-\d{5}\.csv$/i.test(fileName)) {
      continue;
    }

    const fullPath = path.join(datasetDir, fileName);
    const rows = parseCsv(fs.readFileSync(fullPath, "utf8"));

    for (const row of rows) {
      const id = String(row.id || "").trim();
      if (id) {
        ids.add(id);
      }
    }
  }

  return ids;
}

function shouldBePriority(record) {
  return (
    Number(record.jumlahTagAktif) > 0 ||
    Number(record.potensiPemborosan) > 0 ||
    String(record["tags.isInappropriate"] || "").toLowerCase() !== "low"
  );
}

function toPriorityRow(record) {
  return {
    id: Number(record.id),
    paket: record.paket,
    lembaga: record.lembaga,
    ownerType: record.ownerType,
    satker: record.satker,
    pagu: Number(record.pagu),
    potensiPemborosan: Number(record.potensiPemborosan),
    jumlahTagAktif: Number(record.jumlahTagAktif),
    tags: {
      isInappropriate: record["tags.isInappropriate"],
      inappropriateReason: record["tags.inappropriateReason"] || null,
    },
  };
}

async function fetchPackageFromInaproc(code, htmlDir) {
  const url = `https://data.inaproc.id/rup?kode=${encodeURIComponent(code)}`;
  let sessionName = resolveInitialSessionName(code);

  const runOpen = async (targetSessionName) => {
    const commonPrefix = ["--session", targetSessionName];
    const openArgs =
      INAPROC_BROWSER_MODE === "real"
        ? [
            ...commonPrefix,
            "browser",
            "real",
            "open",
            url,
            "--format",
            "json",
            ...(INAPROC_BROWSER_USE_KERNEL ? ["--ba-kernel"] : []),
          ]
        : [...commonPrefix, "browser", "real", "open", url, "--ba-kernel", "--format", "json"];

    await runBrowserAct(openArgs);
  };

  try {
    await runOpen(sessionName);
  } catch (error) {
    const existingSessionName = extractExistingRealSessionName(error);
    if (!existingSessionName) {
      throw error;
    }

    sessionName = existingSessionName;
    await runOpen(sessionName);
  }

  const commonPrefix = ["--session", sessionName];
  await runBrowserAct([...commonPrefix, "wait", "stable", "--format", "json"]);

  const htmlPayload = await runBrowserAct([...commonPrefix, "get", "html", "--format", "json"]);
  const html = String(htmlPayload.html || "");

  fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(path.join(htmlDir, `${code}.html`), html, "utf8");

  if (/akses ditolak|blocked|403/i.test(html)) {
    throw new Error(
      `Akses ke data.inaproc.id untuk kode ${code} diblokir. Gunakan Chrome asli dengan remote debugging atau sumber resmi lain.`
    );
  }

  const fields = extractTableFields(html);
  const rawRecord = extractNextDataRecord(html, code);
  const record = toDatasetRecord(code, fields, rawRecord);

  if (!record.paket || !record.lembaga) {
    throw new Error(`Halaman untuk kode ${code} terbuka, tetapi field penting belum berhasil diparse.`);
  }

  return {
    code: String(code),
    record,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const datasetDir = resolveDatasetDir(args);
  const part = resolvePart(args, datasetDir);
  const force = parseForce(args);
  const fromFailures = parseFromFailures(args);
  const htmlDir = path.join(RAW_OUTPUT_DIR, `part-${part}`);
  const failuresPath = path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}_failures.csv`);
  const explicitCodes = parseCodes(args);
  const { codeSource, sourceFailuresPath, codes } = resolveSourceFailureCodes(
    args,
    datasetDir,
    part,
    explicitCodes,
    fromFailures
  );

  if (!codes.length) {
    throw new Error(
      `No package codes found. Use --codes 63269137,63297396 or provide year-${AUDIT_DATASET_YEAR}.part-${part}_failures.csv with id values${
        Number.parseInt(part, 10) > 1
          ? `, or ensure year-${AUDIT_DATASET_YEAR}.part-${formatPartNumber(Number.parseInt(part, 10) - 1)}_failures.csv has retry IDs`
          : ""
      }.`
    );
  }

  fs.mkdirSync(datasetDir, { recursive: true });
  const csvPath = path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}.csv`);
  const priorityPath = path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}_priority.json`);
  const existingPartRows = readExistingCsvRecords(csvPath);
  const existingPriorityRows = readExistingPriorityRows(priorityPath);
  const existingFailureRows = readExistingFailureRows(failuresPath);
  const existingIds = readExistingCsvIds(datasetDir);
  const partRowMap = new Map(existingPartRows.map((row) => [String(row.id || "").trim(), row]));
  const priorityMap = new Map(existingPriorityRows.map((row) => [String(row.id || "").trim(), row]));
  const failureMap = new Map(existingFailureRows.map((row) => [String(row.id || "").trim(), row]));
  const results = [];

  for (const code of codes) {
    const normalizedCode = String(code).trim();

    if (!force && existingIds.has(normalizedCode)) {
      failureMap.delete(normalizedCode);
      results.push({
        code: normalizedCode,
        skipped: true,
        reason: "already-exists-in-dataset-csv",
      });
      continue;
    }

    try {
      const result = await fetchPackageFromInaproc(normalizedCode, htmlDir);
      partRowMap.set(normalizedCode, result.record);
      existingIds.add(normalizedCode);
      failureMap.delete(normalizedCode);

      if (shouldBePriority(result.record)) {
        priorityMap.set(normalizedCode, toPriorityRow(result.record));
      } else {
        priorityMap.delete(normalizedCode);
      }

      results.push({
        code: normalizedCode,
        written: true,
      });
    } catch (error) {
      failureMap.set(normalizedCode, {
        id: normalizedCode,
        paket: "",
        error: error instanceof Error ? error.message : String(error),
      });

      results.push({
        code: normalizedCode,
        failed: true,
      });
    }
  }

  const csvRows = [CSV_HEADERS.join(",")];
  for (const row of partRowMap.values()) {
    csvRows.push(toCsvRow(row));
  }

  const priorityRows = [...priorityMap.values()].sort((left, right) => Number(left.id) - Number(right.id));
  const failureRows = [["id", "paket", "error"].join(",")];
  for (const failure of failureMap.values()) {
    failureRows.push(
      [escapeCsv(failure.id), escapeCsv(failure.paket || ""), escapeCsv(failure.error || "")].join(",")
    );
  }

  fs.writeFileSync(csvPath, `${csvRows.join("\n")}\n`, "utf8");
  fs.writeFileSync(priorityPath, `${JSON.stringify(priorityRows, null, 2)}\n`, "utf8");
  fs.writeFileSync(failuresPath, `${failureRows.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        part,
        codeSource,
        sourceFailuresPath,
        datasetDir,
        csvPath,
        priorityPath,
        failuresPath,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`Inaproc part sync failed: ${error.message}`);
  process.exitCode = 1;
});
