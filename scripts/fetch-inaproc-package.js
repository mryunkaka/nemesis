const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");
const {
  AUDIT_DATASET_YEAR,
  AUTO_REFRESH_SYNC_CODES,
  DATA_DIR,
  INAPROC_BROWSER_MODE,
  INAPROC_BROWSER_USE_KERNEL,
} = require("../server/config");
const {
  appendJsonlRecord,
  collectLiveSyncIds,
  ensureLiveSyncDirectory,
  nextLiveSyncFilePath,
} = require("../server/live-sync");

const execFileAsync = promisify(execFile);
const RAW_OUTPUT_DIR = path.join(DATA_DIR, "live-sync-raw");

function getFlagValue(args, flagName) {
  const index = args.indexOf(flagName);
  return index === -1 ? "" : String(args[index + 1] || "").trim();
}

function parseCodes(args) {
  const raw = getFlagValue(args, "--codes") || String(AUTO_REFRESH_SYNC_CODES || "").trim();

  return raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveOutputPath(args) {
  const raw = getFlagValue(args, "--out");

  if (!raw) {
    return nextLiveSyncFilePath();
  }

  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

function resolveHtmlDir(args) {
  const raw = getFlagValue(args, "--html-dir");

  if (!raw) {
    return RAW_OUTPUT_DIR;
  }

  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

function parseForce(args) {
  return args.includes("--force");
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

  if (
    String(value.kode ?? value.id ?? value.koderup ?? "").trim() === code
  ) {
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

function toCsvCompatibleRecord(code, fields = {}, rawRecord = null) {
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
  const location =
    rawRecord?.lokasi ||
    fields.lokasi ||
    fields["lokasi paket"] ||
    "";
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
    fields["pemilihan"] ||
    "";
  const volume = rawRecord?.volumePekerjaan || fields["volume pekerjaan"] || "";
  const workDescription = rawRecord?.uraianPekerjaan || fields["uraian pekerjaan"] || "";
  const specification = rawRecord?.spesifikasiPekerjaan || fields["spesifikasi pekerjaan"] || "";

  return {
    paket: String(packageName || "").trim(),
    dalamNegeri: true,
    jenisPengadaan: String(procurementType || "").trim(),
    metode: String(method || "").trim(),
    lembaga: String(ownerName || "").trim(),
    satker: String(satker || "").trim(),
    lokasi: String(location || "").trim(),
    id: Number(code),
    pagu: Number(String(budget || "0").replace(/[^\d.-]/g, "")) || 0,
    pemilihanDate: String(selectionDate || "").trim(),
    sumberDana: String(fundingSource || "").trim(),
    isUMKM: true,
    volumePekerjaan: String(volume || "").trim(),
    uraianPekerjaan: String(workDescription || "").trim(),
    spesifikasiPekerjaan: String(specification || "").trim(),
    ownerType: inferOwnerType(ownerName),
    potensiPemborosan: 0,
    "tags.isInappropriate": "low",
    "tags.inappropriateReason": "Auto-import dari data.inaproc.id tanpa re-analisis AI.",
    jumlahTagAktif: 0,
    _source: "inaproc-web-sync",
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
  const record = toCsvCompatibleRecord(code, fields, rawRecord);

  if (!record.paket || !record.lembaga) {
    throw new Error(`Halaman untuk kode ${code} terbuka, tetapi field penting belum berhasil diparse.`);
  }

  return {
    code,
    url,
    htmlPath: path.join(htmlDir, `${code}.html`),
    record,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const codes = parseCodes(args);
  const outputPath = resolveOutputPath(args);
  const htmlDir = resolveHtmlDir(args);
  const force = parseForce(args);

  if (!codes.length) {
    throw new Error("No package codes provided. Use --codes 63269137 or set AUTO_REFRESH_SYNC_CODES.");
  }

  ensureLiveSyncDirectory();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const existingIds = collectLiveSyncIds();
  const results = [];

  for (const code of codes) {
    const normalizedCode = String(code).trim();

    if (!force && existingIds.has(normalizedCode)) {
      results.push({
        code: normalizedCode,
        skipped: true,
        reason: "already-exists-in-live-sync",
      });
      continue;
    }

    const result = await fetchPackageFromInaproc(code, htmlDir);
    appendJsonlRecord(outputPath, result.record);
    existingIds.add(normalizedCode);
    results.push({
      code: result.code,
      url: result.url,
      htmlPath: result.htmlPath,
      written: true,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        datasetYear: AUDIT_DATASET_YEAR,
        outputPath,
        results,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Inaproc sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchPackageFromInaproc,
  toCsvCompatibleRecord,
};
