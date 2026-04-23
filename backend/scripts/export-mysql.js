#!/usr/bin/env node
/**
 * Export data dari SQLite database ke MySQL
 * 
 * Cara pakai:
 * 1. Edit konfigurasi MySQL di bawah
 * 2. cd backend
 * 3. npm install mysql2
 * 4. node scripts/export-mysql.js
 */

const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');
const path = require('path');

// ============================================
// KONFIGURASI MYSQL - EDIT SESUAI HOSTING ANDA
// ============================================
const MYSQL_CONFIG = {
  host: 'localhost',      // Host database (biasanya localhost)
  user: 'username',     // Username database Anda
  password: 'password', // Password database Anda
  database: 'audit_lkpp' // Nama database (buat dulu di phpMyAdmin)
};
// ============================================

const SQLITE_DB_PATH = path.resolve(__dirname, '../dashboard.db');

async function createTables(connection) {
  console.log('Creating tables...');
  
  await connection.execute(`DROP TABLE IF EXISTS region_metrics`);
  await connection.execute(`DROP TABLE IF EXISTS province_metrics`);
  await connection.execute(`DROP TABLE IF EXISTS owner_metrics`);
  await connection.execute(`DROP TABLE IF EXISTS assets`);
  await connection.execute(`DROP TABLE IF EXISTS regions`);
  await connection.execute(`DROP TABLE IF EXISTS provinces`);
  
  await connection.execute(`
    CREATE TABLE assets (
      \`key\` VARCHAR(255) PRIMARY KEY,
      json LONGTEXT NOT NULL
    )
  `);
  
  await connection.execute(`
    CREATE TABLE regions (
      region_key VARCHAR(255) PRIMARY KEY,
      code VARCHAR(50),
      province_name VARCHAR(255) NOT NULL,
      region_name VARCHAR(255) NOT NULL,
      region_type VARCHAR(50) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      feature_index INT NOT NULL
    )
  `);
  
  await connection.execute(`
    CREATE TABLE region_metrics (
      region_key VARCHAR(255) PRIMARY KEY,
      total_packages INT NOT NULL,
      total_priority_packages INT NOT NULL,
      total_flagged_packages INT NOT NULL,
      total_potential_waste DOUBLE NOT NULL,
      total_budget BIGINT NOT NULL,
      avg_risk_score DOUBLE NOT NULL,
      max_risk_score INT NOT NULL,
      med_severity_packages INT NOT NULL,
      high_severity_packages INT NOT NULL,
      absurd_severity_packages INT NOT NULL,
      FOREIGN KEY (region_key) REFERENCES regions(region_key)
    )
  `);
  
  await connection.execute(`
    CREATE TABLE provinces (
      province_key VARCHAR(255) PRIMARY KEY,
      code VARCHAR(50),
      province_name VARCHAR(255) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      feature_index INT NOT NULL
    )
  `);
  
  await connection.execute(`
    CREATE TABLE province_metrics (
      province_key VARCHAR(255) PRIMARY KEY,
      total_packages INT NOT NULL,
      total_priority_packages INT NOT NULL,
      total_flagged_packages INT NOT NULL,
      total_potential_waste DOUBLE NOT NULL,
      total_budget BIGINT NOT NULL,
      avg_risk_score DOUBLE NOT NULL,
      max_risk_score INT NOT NULL,
      med_severity_packages INT NOT NULL,
      high_severity_packages INT NOT NULL,
      absurd_severity_packages INT NOT NULL,
      FOREIGN KEY (province_key) REFERENCES provinces(province_key)
    )
  `);
  
  await connection.execute(`
    CREATE TABLE owner_metrics (
      owner_type VARCHAR(50) NOT NULL,
      owner_name VARCHAR(255) NOT NULL,
      total_packages INT NOT NULL,
      total_priority_packages INT NOT NULL,
      total_flagged_packages INT NOT NULL,
      total_potential_waste DOUBLE NOT NULL,
      total_budget BIGINT NOT NULL,
      med_severity_packages INT NOT NULL,
      high_severity_packages INT NOT NULL,
      absurd_severity_packages INT NOT NULL,
      PRIMARY KEY (owner_type, owner_name)
    )
  `);
  
  console.log('✓ Tables created');
}

async function exportRegions(connection, sqliteDb) {
  console.log('Exporting regions...');
  const regions = sqliteDb.prepare('SELECT * FROM regions').all();
  
  let count = 0;
  for (const region of regions) {
    await connection.execute(
      `INSERT INTO regions (region_key, code, province_name, region_name, region_type, display_name, feature_index) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [region.region_key, region.code, region.province_name, region.region_name, 
       region.region_type, region.display_name, region.feature_index]
    );
    count++;
    if (count % 100 === 0) {
      process.stdout.write(`\r  ${count}/${regions.length} regions...`);
    }
  }
  console.log(`\r✓ Exported ${count} regions`);
}

async function exportRegionMetrics(connection, sqliteDb) {
  console.log('Exporting region_metrics...');
  const metrics = sqliteDb.prepare('SELECT * FROM region_metrics').all();
  
  let count = 0;
  for (const m of metrics) {
    await connection.execute(
      `INSERT INTO region_metrics (region_key, total_packages, total_priority_packages, 
       total_flagged_packages, total_potential_waste, total_budget, avg_risk_score, 
       max_risk_score, med_severity_packages, high_severity_packages, absurd_severity_packages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.region_key, m.total_packages, m.total_priority_packages, m.total_flagged_packages,
       m.total_potential_waste, m.total_budget, m.avg_risk_score, m.max_risk_score,
       m.med_severity_packages, m.high_severity_packages, m.absurd_severity_packages]
    );
    count++;
    if (count % 100 === 0) {
      process.stdout.write(`\r  ${count}/${metrics.length} metrics...`);
    }
  }
  console.log(`\r✓ Exported ${count} region_metrics`);
}

async function exportProvinces(connection, sqliteDb) {
  console.log('Exporting provinces...');
  const provinces = sqliteDb.prepare('SELECT * FROM provinces').all();
  
  let count = 0;
  for (const p of provinces) {
    await connection.execute(
      `INSERT INTO provinces (province_key, code, province_name, display_name, feature_index) 
       VALUES (?, ?, ?, ?, ?)`,
      [p.province_key, p.code, p.province_name, p.display_name, p.feature_index]
    );
    count++;
  }
  console.log(`✓ Exported ${count} provinces`);
}

async function exportProvinceMetrics(connection, sqliteDb) {
  console.log('Exporting province_metrics...');
  const metrics = sqliteDb.prepare('SELECT * FROM province_metrics').all();
  
  let count = 0;
  for (const m of metrics) {
    await connection.execute(
      `INSERT INTO province_metrics (province_key, total_packages, total_priority_packages, 
       total_flagged_packages, total_potential_waste, total_budget, avg_risk_score, 
       max_risk_score, med_severity_packages, high_severity_packages, absurd_severity_packages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.province_key, m.total_packages, m.total_priority_packages, m.total_flagged_packages,
       m.total_potential_waste, m.total_budget, m.avg_risk_score, m.max_risk_score,
       m.med_severity_packages, m.high_severity_packages, m.absurd_severity_packages]
    );
    count++;
  }
  console.log(`✓ Exported ${count} province_metrics`);
}

async function exportOwnerMetrics(connection, sqliteDb) {
  console.log('Exporting owner_metrics...');
  const metrics = sqliteDb.prepare('SELECT * FROM owner_metrics').all();
  
  let count = 0;
  for (const m of metrics) {
    await connection.execute(
      `INSERT INTO owner_metrics (owner_type, owner_name, total_packages, total_priority_packages, 
       total_flagged_packages, total_potential_waste, total_budget, med_severity_packages, 
       high_severity_packages, absurd_severity_packages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.owner_type, m.owner_name, m.total_packages, m.total_priority_packages, 
       m.total_flagged_packages, m.total_potential_waste, m.total_budget, 
       m.med_severity_packages, m.high_severity_packages, m.absurd_severity_packages]
    );
    count++;
    if (count % 100 === 0) {
      process.stdout.write(`\r  ${count}/${metrics.length} metrics...`);
    }
  }
  console.log(`\r✓ Exported ${count} owner_metrics`);
}

async function exportAssets(connection, sqliteDb) {
  console.log('Exporting assets (GeoJSON, metadata)...');
  const assets = sqliteDb.prepare('SELECT * FROM assets').all();
  
  let count = 0;
  for (const asset of assets) {
    await connection.execute(
      `INSERT INTO assets (\`key\`, json) VALUES (?, ?)`,
      [asset.key, asset.json]
    );
    count++;
    process.stdout.write(`\r  ${count}/${assets.length} assets...`);
  }
  console.log(`\r✓ Exported ${count} assets`);
}

async function exportToMySQL() {
  console.log('========================================');
  console.log('SQLite to MySQL Export');
  console.log('========================================\n');
  
  // Check if SQLite database exists
  const fs = require('fs');
  if (!fs.existsSync(SQLITE_DB_PATH)) {
    console.error(`Error: SQLite database not found: ${SQLITE_DB_PATH}`);
    console.error('\nPastikan Anda sudah menjalankan:');
    console.error('  npm run db:reset');
    console.error('  npm run export:static');
    process.exit(1);
  }
  
  console.log('Connecting to MySQL...');
  let connection;
  try {
    connection = await mysql.createConnection(MYSQL_CONFIG);
  } catch (err) {
    console.error('\n❌ MySQL Connection Error:');
    console.error(err.message);
    console.error('\nPastikan:');
    console.error('1. MySQL server berjalan');
    console.error('2. Konfigurasi MYSQL_CONFIG sudah benar');
    console.error('3. Database sudah dibuat di MySQL');
    console.error('\nEdit file ini dan ubah MYSQL_CONFIG di bagian atas.');
    process.exit(1);
  }
  console.log('✓ Connected to MySQL\n');
  
  // Open SQLite
  console.log('Opening SQLite database...');
  const sqliteDb = new Database(SQLITE_DB_PATH);
  console.log('✓ Opened SQLite\n');
  
  try {
    // Create tables
    await createTables(connection);
    console.log();
    
    // Export data
    await exportRegions(connection, sqliteDb);
    await exportRegionMetrics(connection, sqliteDb);
    await exportProvinces(connection, sqliteDb);
    await exportProvinceMetrics(connection, sqliteDb);
    await exportOwnerMetrics(connection, sqliteDb);
    await exportAssets(connection, sqliteDb);
    
    console.log('\n========================================');
    console.log('✓ Export Complete!');
    console.log('========================================');
    console.log('\nData berhasil diekspor ke MySQL.');
    console.log('Langkah selanjutnya:');
    console.log('1. Upload folder api/ ke hosting Anda');
    console.log('2. Edit api/config.php dengan kredensial hosting');
    console.log('3. Test: https://domain-anda.com/api/regions.php');
    
  } catch (err) {
    console.error('\n❌ Export Error:', err);
    process.exit(1);
  } finally {
    await connection.end();
    sqliteDb.close();
  }
}

// Check for mysql2 module
try {
  require('mysql2');
} catch (e) {
  console.error('Error: mysql2 module not found.');
  console.error('Please run: npm install mysql2');
  process.exit(1);
}

// Run export
exportToMySQL();
