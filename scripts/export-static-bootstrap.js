const fs = require("fs");
const path = require("path");
const { openDatabase } = require("../server/db");
const { getBootstrapPayload } = require("../server/dashboard-repository");

const outputPath = path.resolve(__dirname, "..", "public", "data", "bootstrap.json");
const outputDir = path.dirname(outputPath);

fs.mkdirSync(outputDir, { recursive: true });

const db = openDatabase();

try {
  const startedAt = Date.now();
  const payload = getBootstrapPayload(db);
  fs.writeFileSync(outputPath, JSON.stringify(payload));
  const stats = fs.statSync(outputPath);

  console.log(
    JSON.stringify({
      outputPath,
      bytes: stats.size,
      mb: Number((stats.size / 1024 / 1024).toFixed(2)),
      durationMs: Date.now() - startedAt,
    })
  );
} finally {
  db.close();
}
