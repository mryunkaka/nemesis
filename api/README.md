# MySQL Backend API

API PHP untuk menghubungkan frontend dengan database MySQL.

## Setup Instructions

### 1. Import Database ke MySQL

**Langkah 1: Konversi SQLite dump ke MySQL format**
```bash
cd backend
node scripts/sqlite-to-mysql.js
```

Ini akan menghasilkan file `dashboard-mysql.sql` di root folder.

**Langkah 2: Import ke MySQL via phpMyAdmin**

1. Login ke phpMyAdmin di hosting Anda
2. Buat database baru (contoh: `audit_lkpp`)
3. Pilih tab **Import**
4. Upload file `dashboard-mysql.sql`
5. Klik **Go**

### 2. Konfigurasi API

Edit file `api/config.php`:

```php
define('DB_HOST', 'localhost');       // Host database
define('DB_NAME', 'audit_lkpp');       // Nama database
define('DB_USER', 'username_anda');    // Username database
define('DB_PASS', 'password_anda');    // Password database
```

### 3. Upload ke Hosting

Upload semua file ke hosting Anda:
- Folder `api/` dengan semua file PHP di dalamnya
- File-file frontend (index.html, assets/, dll)

### 4. Update Frontend untuk Menggunakan API MySQL

Edit file `assets/js/app.js` (atau file yang mengakses data):

Ganti semua referensi ke SQLite dengan API endpoint:

```javascript
// SEBELUM (SQLite):
const data = await fetch('data:application/octet-stream;base64,...');

// SESUDAH (MySQL API):
const response = await fetch('/api/regions.php');
const data = await response.json();
```

## API Endpoints

### GET /api/regions.php
Mengembalikan semua region dengan metrics.

### GET /api/regions.php?key={region_key}
Mengembalikan detail satu region.

### GET /api/provinces.php
Mengembalikan semua provinsi dengan metrics.

### GET /api/provinces.php?key={province_key}
Mengembalikan detail satu provinsi.

### GET /api/assets.php?key={asset_key}
Mengembalikan asset JSON (GeoJSON, metadata, dll).

Asset keys yang tersedia:
- `audit_geojson` - GeoJSON kabupaten/kota
- `audit_province_geojson` - GeoJSON provinsi
- `audit_metadata` - Metadata import
- `audit_regions` - Data regions
- `audit_provinces` - Data provinsi
- `audit_region_metrics` - Metrics regions
- `audit_province_metrics` - Metrics provinsi
- `audit_owner_metrics` - Metrics owner

## Troubleshooting

### Error "Database connection failed"
- Pastikan kredensial di `config.php` benar
- Pastikan database sudah dibuat di phpMyAdmin
- Pastikan user database memiliki permission yang cukup

### Error "Asset not found"
- Pastikan data sudah diimport ke tabel `assets`
- Pastikan key yang diminta valid

### Data masih kosong setelah import
- Periksa apakah tabel `regions` dan `region_metrics` terisi
- Periksa apakah foreign key constraints terpenuhi
