const fs = require("fs");
const path = require("path");
const { openDatabase } = require("../server/db");
const { AUDIT_DATASET_DIR, AUDIT_DATASET_YEAR, DATA_DIR } = require("../server/config");
const {
  createLocationResolver,
  ensureOwnerMetricsCompatibility,
  ensureRegionMetricsCompatibility,
  loadGeoRegistry,
  loadProvinceGeoRegistry,
  materializeOwnerMetrics,
  materializeProvinceMetrics,
  materializeRegionMetrics,
  normalizeAuditRow,
} = require("../server/seed");
const { fetchPackageFromInaproc } = require("./fetch-inaproc-package");

const RAW_OUTPUT_DIR = path.join(DATA_DIR, "live-sync-raw");

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
  return lastPart > 0 ? String(lastPart + 1).padStart(5, "0") : "";
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

function parseLimit(args) {
  const raw = getFlagValue(args, "--limit");
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

function readCsvRows(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function isMissingValue(value) {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

function isInvalidDatasetRow(row) {
  if (!row) {
    return true;
  }

  const hasId = !isMissingValue(row.id);
  const hasPackageName = !isMissingValue(row.paket);
  const hasOwnerName = !isMissingValue(row.lembaga);
  const hasLocation = !isMissingValue(row.lokasi);
  const hasProcurementType = !isMissingValue(row.jenisPengadaan);
  const hasBudget = !isMissingValue(row.pagu);

  return !(hasId && hasPackageName && hasOwnerName && hasLocation && hasProcurementType && hasBudget);
}

function readInvalidPartCodes(filePath) {
  return readCsvRows(filePath)
    .filter((row) => !isMissingValue(row.id) && isInvalidDatasetRow(row))
    .map((row) => String(row.id).trim());
}

function resolveDiscoveredCodes(args, datasetDir, part, explicitCodes) {
  if (explicitCodes.length) {
    return {
      codeSource: "explicit",
      sourceFailuresPath: null,
      sourcePartCsvPath: null,
      codes: explicitCodes,
    };
  }

  if (!part) {
    return {
      codeSource: "none",
      sourceFailuresPath: null,
      sourcePartCsvPath: null,
      codes: [],
    };
  }

  const currentFailuresPath = path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}_failures.csv`);
  const currentPartCsvPath = path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}.csv`);
  const currentFailureCodes = readFailureCodes(currentFailuresPath);

  if (currentFailureCodes.length) {
    return {
      codeSource: "current-part-failures",
      sourceFailuresPath: currentFailuresPath,
      sourcePartCsvPath: currentPartCsvPath,
      codes: currentFailureCodes,
    };
  }

  const currentInvalidCodes = readInvalidPartCodes(currentPartCsvPath);
  if (currentInvalidCodes.length) {
    return {
      codeSource: "current-part-invalid-rows",
      sourceFailuresPath: currentFailuresPath,
      sourcePartCsvPath: currentPartCsvPath,
      codes: currentInvalidCodes,
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
        sourcePartCsvPath: currentPartCsvPath,
        codes: previousFailureCodes,
      };
    }
  }

  return {
    codeSource: "none",
    sourceFailuresPath: currentFailuresPath,
    sourcePartCsvPath: currentPartCsvPath,
    codes: [],
  };
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function loadExistingPackageRows(db, codes) {
  const rows = new Map();
  const chunkSize = 500;

  for (let offset = 0; offset < codes.length; offset += chunkSize) {
    const chunk = codes.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const result = db
      .prepare(
        `SELECT id, inserted_order
         FROM packages
         WHERE id IN (${placeholders})`
      )
      .all(...chunk);

    for (const row of result) {
      rows.set(String(row.id), row);
    }
  }

  return rows;
}

function assertRuntimeSchema(db) {
  const requiredTables = ["packages", "regions", "provinces", "package_regions", "package_provinces"];

  for (const tableName of requiredTables) {
    const found = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);

    if (!found) {
      throw new Error(`Table "${tableName}" is missing. Run npm run db:reset once before incremental sync.`);
    }
  }
}

function deleteAndRebuildMetrics(db) {
  ensureRegionMetricsCompatibility(db);
  ensureOwnerMetricsCompatibility(db);

  const hasProvinceMetricsTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'province_metrics'")
    .get();

  if (!hasProvinceMetricsTable) {
    throw new Error('Table "province_metrics" is missing. Run npm run db:reset once before incremental sync.');
  }

  db.transaction(() => {
    db.exec(`
      DELETE FROM region_metrics;
      DELETE FROM province_metrics;
      DELETE FROM owner_metrics;
    `);
    materializeRegionMetrics(db);
    materializeProvinceMetrics(db);
    materializeOwnerMetrics(db);
  })();
}

function updateAuditMetadata(db) {
  const existing = db.prepare("SELECT json FROM assets WHERE key = 'audit_metadata'").get();
  let metadata = {};

  if (existing && existing.json) {
    try {
      metadata = JSON.parse(existing.json);
    } catch {
      metadata = {};
    }
  }

  const counts = db.prepare(`
    SELECT
      COUNT(*) AS totalRows,
      COALESCE(SUM(CASE WHEN mapped_region_count = 0 THEN 1 ELSE 0 END), 0) AS unmappedPackageCount,
      COALESCE(SUM(CASE WHEN mapped_region_count > 1 THEN 1 ELSE 0 END), 0) AS multiLocationPackageCount
    FROM packages
  `).get();

  const merged = {
    ...metadata,
    importedAt: new Date().toISOString(),
    totalRows: counts.totalRows || 0,
    unmappedPackageCount: counts.unmappedPackageCount || 0,
    multiLocationPackageCount: counts.multiLocationPackageCount || 0,
  };

  db.prepare("INSERT OR REPLACE INTO assets (key, json) VALUES (?, ?)").run(
    "audit_metadata",
    JSON.stringify(merged)
  );
}

async function main() {
  const args = process.argv.slice(2);
  const datasetDir = resolveDatasetDir(args);
  const part = resolvePart(args, datasetDir);
  const explicitCodes = parseCodes(args);
  const force = parseForce(args);
  const limit = parseLimit(args);
  const htmlDir = path.join(RAW_OUTPUT_DIR, part ? `sqlite-part-${part}` : "sqlite-manual");
  const partCsvPath = part
    ? path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}.csv`)
    : "";
  const failuresPath = part
    ? path.join(datasetDir, `year-${AUDIT_DATASET_YEAR}.part-${part}_failures.csv`)
    : "";
  const {
    codeSource,
    sourceFailuresPath,
    sourcePartCsvPath,
    codes: discoveredCodes,
  } = resolveDiscoveredCodes(args, datasetDir, part, explicitCodes);
  const allCodes = uniqueValues(discoveredCodes);

  if (!allCodes.length) {
    throw new Error(
      part
        ? `No package codes found. Provide --codes, fill year-${AUDIT_DATASET_YEAR}.part-${part}_failures.csv, ensure year-${AUDIT_DATASET_YEAR}.part-${part}.csv contains rows with missing/invalid required fields, or ensure year-${AUDIT_DATASET_YEAR}.part-${formatPartNumber(Number.parseInt(part, 10) - 1)}_failures.csv has retry IDs.`
        : "No package codes found. Use --codes 63269137,63297396 or provide --part 00002."
    );
  }

  const db = openDatabase();

  try {
    assertRuntimeSchema(db);

    const existingRowsForAllCodes = loadExistingPackageRows(db, allCodes);
    const allPendingFetchCodes = force
      ? allCodes.slice()
      : allCodes.filter((code) => !existingRowsForAllCodes.has(String(code).trim()));
    const codes = limit > 0 ? allPendingFetchCodes.slice(0, limit) : allPendingFetchCodes;
    const existingRows = loadExistingPackageRows(db, codes);

    const currentMaxInsertedOrder =
      db.prepare("SELECT COALESCE(MAX(inserted_order), 0) AS value FROM packages").get().value || 0;
    let nextInsertedOrder = currentMaxInsertedOrder;
    const pendingFetchCodes = codes.slice();

    const upsertPackage = db.prepare(`
      INSERT INTO packages (
        id, source_id, schema_version, owner_name, owner_type, satker, package_name,
        procurement_type, procurement_method, location_raw, budget, selection_date,
        funding_source, is_umkm, within_country, volume, work_description, specification,
        potential_waste, severity, reason, is_mencurigakan, is_pemborosan, risk_score,
        active_tag_count, is_priority, is_flagged, mapped_region_count, inserted_order
      ) VALUES (
        @id, @source_id, @schema_version, @owner_name, @owner_type, @satker, @package_name,
        @procurement_type, @procurement_method, @location_raw, @budget, @selection_date,
        @funding_source, @is_umkm, @within_country, @volume, @work_description, @specification,
        @potential_waste, @severity, @reason, @is_mencurigakan, @is_pemborosan, @risk_score,
        @active_tag_count, @is_priority, @is_flagged, @mapped_region_count, @inserted_order
      )
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id,
        schema_version = excluded.schema_version,
        owner_name = excluded.owner_name,
        owner_type = excluded.owner_type,
        satker = excluded.satker,
        package_name = excluded.package_name,
        procurement_type = excluded.procurement_type,
        procurement_method = excluded.procurement_method,
        location_raw = excluded.location_raw,
        budget = excluded.budget,
        selection_date = excluded.selection_date,
        funding_source = excluded.funding_source,
        is_umkm = excluded.is_umkm,
        within_country = excluded.within_country,
        volume = excluded.volume,
        work_description = excluded.work_description,
        specification = excluded.specification,
        potential_waste = excluded.potential_waste,
        severity = excluded.severity,
        reason = excluded.reason,
        is_mencurigakan = excluded.is_mencurigakan,
        is_pemborosan = excluded.is_pemborosan,
        risk_score = excluded.risk_score,
        active_tag_count = excluded.active_tag_count,
        is_priority = excluded.is_priority,
        is_flagged = excluded.is_flagged,
        mapped_region_count = excluded.mapped_region_count,
        inserted_order = excluded.inserted_order
    `);
    const deletePackageRegions = db.prepare("DELETE FROM package_regions WHERE package_id = ?");
    const deletePackageProvinces = db.prepare("DELETE FROM package_provinces WHERE package_id = ?");
    const insertPackageRegion = db.prepare(
      "INSERT INTO package_regions (package_id, region_key) VALUES (?, ?)"
    );
    const insertPackageProvince = db.prepare(
      "INSERT INTO package_provinces (package_id, province_key) VALUES (?, ?)"
    );

    const applyPackage = db.transaction((record, regionKeys, provinceKeys) => {
      upsertPackage.run(record);
      deletePackageRegions.run(record.id);
      deletePackageProvinces.run(record.id);

      for (const regionKey of regionKeys) {
        insertPackageRegion.run(record.id, regionKey);
      }

      for (const provinceKey of provinceKeys) {
        insertPackageProvince.run(record.id, provinceKey);
      }
    });

    const results = [];

    if (!pendingFetchCodes.length) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            dbMode: "incremental-upsert",
            dbUpdated: false,
            part: part || null,
            codeSource,
            partCsvPath: partCsvPath || null,
            failuresPath: failuresPath || null,
            sourcePartCsvPath: sourcePartCsvPath || null,
            sourceFailuresPath: sourceFailuresPath || null,
            requestedCodeCount: allCodes.length,
            processedCodeCount: codes.length,
            pendingCandidateCount: allPendingFetchCodes.length,
            results,
          },
          null,
          2
        )
      );
      return;
    }

    const geoRegistry = loadGeoRegistry();
    const provinceRegistry = loadProvinceGeoRegistry();
    const resolveLocation = createLocationResolver(
      geoRegistry.lookup,
      provinceRegistry.lookup,
      geoRegistry.lookup
    );

    let appliedCount = 0;

    for (const code of pendingFetchCodes) {
      const normalizedCode = String(code).trim();
      const existingRow = existingRows.get(normalizedCode);

      try {
        const fetched = await fetchPackageFromInaproc(normalizedCode, htmlDir);
        const insertedOrder = existingRow ? existingRow.inserted_order : ++nextInsertedOrder;
        const normalizedRecord = normalizeAuditRow(
          {
            ...fetched.record,
            id: normalizedCode,
          },
          insertedOrder - 1
        );
        const { regionKeys, provinceKeys } = resolveLocation(normalizedRecord.location_raw);
        normalizedRecord.mapped_region_count = regionKeys.length;
        normalizedRecord.inserted_order = insertedOrder;

        applyPackage(normalizedRecord, regionKeys, provinceKeys);
        existingRows.set(normalizedCode, { id: normalizedCode, inserted_order: insertedOrder });
        appliedCount += 1;

        results.push({
          code: normalizedCode,
          upserted: true,
          mappedRegionCount: regionKeys.length,
          mappedProvinceCount: provinceKeys.length,
          htmlPath: fetched.htmlPath,
        });
      } catch (error) {
        results.push({
          code: normalizedCode,
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (appliedCount > 0) {
      deleteAndRebuildMetrics(db);
      updateAuditMetadata(db);
    }

    const summary = db.prepare(`
      SELECT
        COUNT(*) AS packageCount,
        COALESCE(SUM(CASE WHEN mapped_region_count = 0 THEN 1 ELSE 0 END), 0) AS unmappedPackageCount,
        COALESCE(SUM(CASE WHEN mapped_region_count > 1 THEN 1 ELSE 0 END), 0) AS multiLocationPackageCount
      FROM packages
    `).get();

    console.log(
      JSON.stringify(
        {
          ok: true,
          dbMode: "incremental-upsert",
          dbUpdated: appliedCount > 0,
          part: part || null,
          codeSource,
          partCsvPath: partCsvPath || null,
          failuresPath: failuresPath || null,
          sourcePartCsvPath: sourcePartCsvPath || null,
          sourceFailuresPath: sourceFailuresPath || null,
          requestedCodeCount: allCodes.length,
          processedCodeCount: codes.length,
          pendingCandidateCount: allPendingFetchCodes.length,
          appliedCount,
          results,
          summary,
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`SQLite sync failed: ${error.message}`);
  process.exitCode = 1;
});
