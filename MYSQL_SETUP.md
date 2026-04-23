# Setup MySQL Database

## Cara Import Data SQLite ke MySQL (Tanpa Konversi Manual)

### Opsi 1: Gunakan Script Export Langsung ke MySQL (Direkomendasikan)

**Langkah 1: Modifikasi backend untuk export ke MySQL**

Buat file baru `backend/scripts/export-mysql.js`:

```javascript
const fs = require('fs');
const mysql = require('mysql2/promise');
const path = require('path');

async function exportToMySQL() {
  // Konfigurasi MySQL - ubah sesuai kredensial Anda
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'username_anda',
    password: 'password_anda',
    database: 'audit_lkpp'
  });

  const sqlite = require('better-sqlite3');
  const db = sqlite(path.resolve(__dirname, '../../dashboard.db'));

  // Export regions
  const regions = db.prepare('SELECT * FROM regions').all();
  for (const region of regions) {
    await connection.execute(
      `INSERT INTO regions (region_key, code, province_name, region_name, region_type, display_name, feature_index) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [region.region_key, region.code, region.province_name, region.region_name, 
       region.region_type, region.display_name, region.feature_index]
    );
  }

  // Export region_metrics
  const metrics = db.prepare('SELECT * FROM region_metrics').all();
  for (const m of metrics) {
    await connection.execute(
      `INSERT INTO region_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.region_key, m.total_packages, m.total_priority_packages, m.total_flagged_packages,
       m.total_potential_waste, m.total_budget, m.avg_risk_score, m.max_risk_score,
       m.med_severity_packages, m.high_severity_packages, m.absurd_severity_packages]
    );
  }

  // Export assets (GeoJSON, metadata)
  const assets = db.prepare('SELECT * FROM assets').all();
  for (const asset of assets) {
    await connection.execute(
      `INSERT INTO assets VALUES (?, ?)`,
      [asset.key, asset.json]
    );
  }

  console.log('Export complete!');
  await connection.end();
  db.close();
}

exportToMySQL().catch(console.error);
```

**Langkah 2: Jalankan script export**
```bash
cd backend
npm install mysql2
node scripts/export-mysql.js
```

---

### Opsi 2: Import Manual via phpMyAdmin

**Langkah 1: Buat struktur tabel di phpMyAdmin**

Jalankan SQL ini di tab "SQL" phpMyAdmin:

```sql
-- Struktur tabel untuk MySQL

CREATE TABLE assets (
  `key` VARCHAR(255) PRIMARY KEY,
  json LONGTEXT NOT NULL
);

CREATE TABLE regions (
  region_key VARCHAR(255) PRIMARY KEY,
  code VARCHAR(50),
  province_name VARCHAR(255) NOT NULL,
  region_name VARCHAR(255) NOT NULL,
  region_type VARCHAR(50) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  feature_index INT NOT NULL
);

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
);

CREATE TABLE provinces (
  province_key VARCHAR(255) PRIMARY KEY,
  code VARCHAR(50),
  province_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  feature_index INT NOT NULL
);

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
);
```

**Langkah 2: Export data dari SQLite ke CSV**

Jalankan di terminal lokal Anda:
```bash
cd backend
sqlite3 dashboard.db <<EOF
.mode csv
.headers on
.output regions.csv
SELECT * FROM regions;
.output region_metrics.csv
SELECT * FROM region_metrics;
.output provinces.csv
SELECT * FROM provinces;
.output province_metrics.csv
SELECT * FROM province_metrics;
.output assets.csv
SELECT * FROM assets;
.quit
EOF
```

**Langkah 3: Import CSV ke MySQL via phpMyAdmin**

1. Buka phpMyAdmin
2. Pilih database `audit_lkpp`
3. Pilih tabel (misal: `regions`)
4. Tab **Import**
5. Format: **CSV**
6. Centang "The first line of the file contains the table column names"
7. Pilih file `regions.csv`
8. Klik **Go**

Ulangi untuk tabel lainnya.

---

### Opsi 3: Gunakan Tool Online/Third-party

Gunakan tool konversi online seperti:
- https://www.rebasedata.com/convert-sqlite-to-mysql-online
- https://tableconvert.com/sqlite-to-mysql

Upload `dashboard.db` atau `dashboard.sql`, download hasil konversi, lalu import ke phpMyAdmin.

---

## Setup API PHP di Hosting

Setelah data diimport ke MySQL:

### 1. Upload file API
Upload semua file di folder `api/` ke hosting Anda.

### 2. Konfigurasi Database
Edit `api/config.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'audit_lkpp');
define('DB_USER', 'username_cpanel_anda');
define('DB_PASS', 'password_cpanel_anda');
```

### 3. Test API
Buka browser:
```
https://domain-anda.com/api/regions.php
```

Harusnya muncul JSON data regions.

---

## Update Frontend

Edit file `assets/js/app.js` atau tempat frontend mengakses data:

**Ganti dari:**
```javascript
// Akses SQLite langsung (tidak bisa di hosting tanpa SSH)
const db = new SQL.Database(buffer);
```

**Ke:**
```javascript
// Akses via API MySQL
const response = await fetch('/api/regions.php');
const regions = await response.json();
```

Lihat file `api/README.md` untuk detail lengkap API endpoints.
