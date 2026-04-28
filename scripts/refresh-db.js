const { AUTO_REFRESH_ADMIN_TOKEN, PORT } = require("../server/config");
const { openDatabase } = require("../server/db");
const { createDataRefreshService } = require("../server/data-refresh");

async function tryRefreshViaRunningServer() {
  const headers = {
    "Content-Type": "application/json",
  };

  if (AUTO_REFRESH_ADMIN_TOKEN) {
    headers.Authorization = `Bearer ${AUTO_REFRESH_ADMIN_TOKEN}`;
  }

  let response;

  try {
    response = await fetch(`http://127.0.0.1:${PORT}/api/admin/refresh`, {
      method: "POST",
      headers,
    });
  } catch {
    return null;
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage =
      payload && payload.error ? payload.error : `Refresh API failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

async function refreshDirectly() {
  const db = openDatabase();
  const refreshService = createDataRefreshService(db);

  try {
    return await refreshService.run("manual-cli");
  } finally {
    db.close();
  }
}

async function main() {
  const viaServerResult = await tryRefreshViaRunningServer();

  if (viaServerResult) {
    console.log("Refresh completed via running server.");
    console.log(JSON.stringify(viaServerResult, null, 2));
    return;
  }

  try {
    const result = await refreshDirectly();
    console.log("Refresh completed.");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error && error.code === "SQLITE_BUSY") {
      throw new Error(
        "database is locked. If backend is running, set AUTO_REFRESH_ADMIN_TOKEN if needed and use the running server refresh path."
      );
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(`Refresh failed: ${error.message}`);
  process.exitCode = 1;
});
