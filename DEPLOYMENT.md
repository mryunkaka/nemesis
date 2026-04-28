# Deployment Guide

## Shared Hosting PHP

Jika hosting Anda hanya menyediakan PHP dan tidak bisa menjalankan Node.js, gunakan mode PHP yang sekarang tersedia di repo ini.

Kebutuhan minimum:

- Apache dengan `mod_rewrite`
- PHP dengan ekstensi `pdo_sqlite` atau `sqlite3`
- Document root boleh tetap ke root repo

File yang wajib ada di hosting:

- `.env`
- `data/dashboard.sqlite`
- folder `public/`
- folder `api/`
- file `.htaccess`

Nilai `.env` minimum untuk mode ini:

```env
PORT=3000
CORS_ORIGIN=*
SQLITE_PATH=data/dashboard.sqlite
AUDIT_DATASET_DIR=dataset
LIVE_SYNC_DIR=data/live-sync
GEO_ROOT_PATH=seed
AUTO_REFRESH_ENABLED=false
AUTO_REFRESH_RUN_ON_STARTUP=false
AUTO_REFRESH_HOUR=1
AUTO_REFRESH_MINUTE=0
AUTO_REFRESH_TIMEZONE=Asia/Jakarta
AUTO_REFRESH_SOURCE_MODE=none
AUTO_REFRESH_SOURCE_URLS=
AUTO_REFRESH_HEADERS_JSON=
AUTO_REFRESH_CLEAN_DATASET_DIR=false
AUTO_REFRESH_TIMEOUT_MS=300000
AUTO_REFRESH_COMMAND=
AUTO_REFRESH_SYNC_CODES=
AUTO_REFRESH_ADMIN_TOKEN=
AUTO_REFRESH_ALLOW_MANUAL_TRIGGER=true
INAPROC_BROWSER_MODE=real
INAPROC_BROWSER_USE_KERNEL=false
```

Catatan:

- mode PHP ini hanya melayani endpoint baca dashboard
- endpoint refresh admin Node tidak tersedia di PHP
- jika hosting tidak punya `pdo_sqlite` maupun `sqlite3`, backend PHP tidak bisa membaca `dashboard.sqlite`

## Quick Start untuk Hosting

### 1. Clone & Install

```bash
git clone https://github.com/assai-id/nemesis.git
cd nemesis
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
# Edit .env sesuai konfigurasi hosting
```

### 3. Upload Database (Manual)

Database tidak ikut di git (file besar). Upload manual ke hosting:

```bash
# Contoh: upload dashboard.sqlite ke folder data/
# via FTP/SCP/Panel hosting
scp dashboard.sqlite user@hosting:/path/to/nemesis/data/
```

### 4. Start Server

```bash
npm start
```

Server akan jalan di `http://localhost:3000` (atau port yang diatur di `.env`).

---

## Struktur Folder (New)

```
nemesis/
├── .env              # Konfigurasi environment
├── .env.example      # Template environment
├── package.json      # Root package (single entry)
├── public/           # Frontend static files
│   ├── index.html
│   └── assets/
├── server/           # Backend Express.js
│   ├── server.js     # Entry point
│   ├── app.js        # Express app
│   ├── config.js     # Konfigurasi
│   ├── db.js         # Database connection
│   └── ...
├── scripts/          # Utility scripts
│   ├── reset-db.js
│   ├── export-db.js
│   └── import-db.js
├── seed/             # Seed data (geojson)
└── data/             # SQLite database (gitignored)
```

---

## Update dari Git

```bash
git pull origin main
npm install  # jika ada dependency baru
# Restart server (pm2 restart nemesis atau manual)
```

**Note:** Database (`data/dashboard.sqlite`) tidak akan ter-overwrite karena di `.gitignore`.

---

## Development Mode

```bash
npm run dev  # dengan auto-reload
```

## Production Mode

```bash
npm start
```

## Auto Refresh Harian

Project ini sekarang bisa refresh dataset dan rebuild database otomatis dari proses Node yang sama, jadi setelah `git pull` di hosting Anda cukup mengatur `.env`.

Contoh minimum:

```env
AUTO_REFRESH_ENABLED=true
AUTO_REFRESH_HOUR=1
AUTO_REFRESH_MINUTE=0
AUTO_REFRESH_TIMEZONE=Asia/Jakarta
AUTO_REFRESH_SOURCE_MODE=http
AUTO_REFRESH_SOURCE_URLS=https://example.com/year-{year}.part-00001.csv,https://example.com/year-{year}.part-00002.csv
AUTO_REFRESH_CLEAN_DATASET_DIR=true
AUTO_REFRESH_ADMIN_TOKEN=ganti-dengan-token-rahasia
```

Mode yang tersedia:

- `AUTO_REFRESH_SOURCE_MODE=none`
  Backend hanya rebuild dari file dataset lokal yang sudah ada.

- `AUTO_REFRESH_SOURCE_MODE=http`
  Backend download file CSV/JSONL dari URL yang diberikan di `AUTO_REFRESH_SOURCE_URLS`.

- `AUTO_REFRESH_SOURCE_MODE=command`
  Backend menjalankan command kustom untuk scraping/download jika sumber data butuh browser/login.

Overlay live sync:

- hasil fetch tambahan tidak perlu menimpa CSV besar di `AUDIT_DATASET_DIR`
- simpan row sinkronisasi ke `LIVE_SYNC_DIR`
- saat seed berjalan, row di `LIVE_SYNC_DIR` akan dioverlay di atas dataset utama berdasarkan `id`
- jika `id` yang sama ada di CSV utama dan live-sync, versi live-sync yang dipakai

Contoh fetch per kode dari data.inaproc.id:

```bash
npm run sync:inaproc -- --codes 63269137
```

Atau jadikan command refresh:

```env
AUTO_REFRESH_SOURCE_MODE=command
AUTO_REFRESH_COMMAND=node scripts/fetch-inaproc-package.js
AUTO_REFRESH_SYNC_CODES=63269137
LIVE_SYNC_DIR=data/live-sync
```

Catatan teknis penting:

- `data.inaproc.id` saat ini dilindungi mekanisme anti-bot / Cloudflare
- script fetch memakai `browser-act`
- pada banyak lingkungan, mode kernel/headless akan diblokir
- mode yang paling realistis untuk uji lokal adalah browser Chrome asli dengan remote debugging diaktifkan
- untuk shared hosting, automasi langsung ke situs ini belum bisa dianggap andal tanpa sumber resmi/API atau service scraper eksternal

Trigger manual:

```bash
npm run db:refresh
```

Perilaku `npm run db:refresh`:

- jika backend sedang hidup di `127.0.0.1:$PORT`, script akan memanggil endpoint refresh internal
- jika backend tidak hidup, script akan refresh langsung lewat proses CLI
- jika endpoint admin diproteksi token, isi `AUTO_REFRESH_ADMIN_TOKEN` di `.env`

Endpoint admin:

- `GET /api/admin/refresh/status`
- `POST /api/admin/refresh`
- `GET /api/admin/refresh/run`

Jika `AUTO_REFRESH_ADMIN_TOKEN` diisi, kirim:

```http
Authorization: Bearer <token>
```

Untuk shared hosting tanpa terminal, Anda bisa:

1. upload file JSONL hasil scraper lokal ke `data/live-sync/`
2. buka URL:

```text
https://domain-anda/api/admin/refresh/run?token=TOKEN_ANDA
```

---

## Environment Variables

| Variable | Default | Keterangan |
|----------|---------|------------|
| `PORT` | 3000 | Port server |
| `CORS_ORIGIN` | * | Domain yang diizinkan |
| `SQLITE_PATH` | data/dashboard.sqlite | Path database |
| `AUDIT_DATASET_DIR` | dataset | Folder dataset |
| `GEO_ROOT_PATH` | seed/geo | Folder GeoJSON |
