const fs = require("fs");
const path = require("path");
const { openDatabase, resolveRuntimeDbPath } = require("../src/db");
const { getBootstrapPayload, getRegionPackages, getProvincePackages, getOwnerPackages } = require("../src/dashboard-repository");

const db = openDatabase();
const runtimeDbPath = resolveRuntimeDbPath();

// Export directory
const exportDir = path.join(__dirname, "..", "frontend", "data");
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

try {
  console.log("Exporting database to static JSON files...");
  console.log(`Database: ${runtimeDbPath}`);
  console.log(`Export directory: ${exportDir}`);

  // Export bootstrap data
  console.log("Exporting bootstrap data...");
  const bootstrapPayload = getBootstrapPayload(db);
  fs.writeFileSync(
    path.join(exportDir, "bootstrap.json"),
    JSON.stringify(bootstrapPayload, null, 2)
  );
  console.log("✓ bootstrap.json exported");

  // Export all regions packages
  console.log("Exporting regions packages...");
  const regionsDir = path.join(exportDir, "regions");
  if (!fs.existsSync(regionsDir)) {
    fs.mkdirSync(regionsDir, { recursive: true });
  }

  const regionKeys = bootstrapPayload.regions.map((r) => r.regionKey);
  regionKeys.forEach((regionKey) => {
    const payload = getRegionPackages(db, regionKey, { page: 1, pageSize: 1000 });
    if (payload) {
      const safeKey = regionKey.replace(/[^a-z0-9-]/gi, "_");
      fs.writeFileSync(
        path.join(regionsDir, `${safeKey}.json`),
        JSON.stringify(payload, null, 2)
      );
    }
  });
  console.log(`✓ ${regionKeys.length} region packages exported`);

  // Export all provinces packages
  console.log("Exporting provinces packages...");
  const provincesDir = path.join(exportDir, "provinces");
  if (!fs.existsSync(provincesDir)) {
    fs.mkdirSync(provincesDir, { recursive: true });
  }

  const provinceKeys = bootstrapPayload.provinceView.provinces.map((p) => p.provinceKey);
  provinceKeys.forEach((provinceKey) => {
    const payload = getProvincePackages(db, provinceKey, { page: 1, pageSize: 1000 });
    if (payload) {
      const safeKey = provinceKey.replace(/[^a-z0-9-]/gi, "_");
      fs.writeFileSync(
        path.join(provincesDir, `${safeKey}.json`),
        JSON.stringify(payload, null, 2)
      );
    }
  });
  console.log(`✓ ${provinceKeys.length} province packages exported`);

  // Export central owners packages
  console.log("Exporting central owners packages...");
  const ownersDir = path.join(exportDir, "owners");
  if (!fs.existsSync(ownersDir)) {
    fs.mkdirSync(ownersDir, { recursive: true });
  }

  const centralOwners = bootstrapPayload.ownerLists.central;
  centralOwners.forEach((owner) => {
    const payload = getOwnerPackages(db, {
      ownerType: owner.ownerType,
      ownerName: owner.ownerName,
      page: 1,
      pageSize: 1000,
    });
    if (payload) {
      const safeKey = `${owner.ownerType}_${owner.ownerName.replace(/[^a-z0-9-]/gi, "_")}`;
      fs.writeFileSync(
        path.join(ownersDir, `${safeKey}.json`),
        JSON.stringify(payload, null, 2)
      );
    }
  });
  console.log(`✓ ${centralOwners.length} central owner packages exported`);

  console.log("\n✅ Static export complete!");
  console.log(`📁 Files exported to: ${exportDir}`);
  console.log("\nNext steps:");
  console.log("1. Update frontend to use static data");
  console.log("2. Upload frontend folder to shared hosting");
} catch (error) {
  console.error("❌ Export failed:", error);
  process.exit(1);
} finally {
  db.close();
}
