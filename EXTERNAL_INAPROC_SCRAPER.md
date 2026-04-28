# External INAPROC Scraper

Dokumen ini menjelaskan workflow scraper eksternal untuk `nemesis`.

Tujuan:

- scraper dijalankan di mesin lokal / VPS Anda
- hasil scraper berupa file `.jsonl`
- file hasil itu di-upload manual ke hosting
- hosting tidak perlu scraping langsung ke `inaproc.id`

## 1. Konsep

Project `nemesis` sekarang mendukung overlay data tambahan melalui folder `live-sync`.

Alurnya:

1. jalankan scraper eksternal untuk mengambil package dari `data.inaproc.id`
2. scraper menghasilkan file JSONL
3. upload file JSONL ke hosting, misalnya ke:
   `data/live-sync/year-2026.sync-00001.jsonl`
4. jalankan:
   `npm run db:refresh`
5. seed akan membaca:
   - dataset utama dari `AUDIT_DATASET_DIR`
   - overlay tambahan dari `LIVE_SYNC_DIR`
6. jika `id` sama sudah ada di CSV utama, versi `live-sync` yang dipakai

## 2. Keterbatasan Penting

`data.inaproc.id` memakai proteksi anti-bot.

Akibatnya:

- mode headless / kernel bisa diblokir
- mode yang paling mungkin berhasil adalah Chrome asli dengan remote debugging aktif

Selain itu, data dari web adalah data mentah. Kolom audit seperti:

- `potensiPemborosan`
- `tags.isInappropriate`
- `jumlahTagAktif`

tidak otomatis tersedia dari sumber web. Untuk sekarang scraper akan mengisi nilai default netral agar row tetap kompatibel dengan pipeline seed.

## 3. Prasyarat Lokal

Di mesin scraper:

- Node.js 18+
- `browser-act` tersedia
- Google Chrome terpasang

Cek:

```powershell
browser-act --version
```

## 4. Aktifkan Remote Debugging Chrome

Tutup semua Chrome, lalu jalankan Chrome dengan remote debugging.

Contoh Windows:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\chrome-inaproc-sync"
```

Setelah Chrome terbuka:

1. buka `chrome://inspect/#remote-debugging`
2. aktifkan remote debugging jika diminta
3. izinkan dialog "Allow Remote Debugging"

## 5. Jalankan Scraper

Contoh scrape satu kode:

```powershell
npm run sync:inaproc -- --codes 63269137 --out temp\year-2026.sync-00001.jsonl
```

Contoh scrape banyak kode:

```powershell
npm run sync:inaproc -- --codes 63269137,63297396,63317752 --out temp\year-2026.sync-00001.jsonl
```

Opsi penting:

- `--codes`
  daftar kode RUP, dipisah koma

- `--out`
  path file JSONL hasil

- `--html-dir`
  folder untuk menyimpan HTML mentah hasil scrape

- `--force`
  tetap tulis ulang walau `id` sudah ada di `LIVE_SYNC_DIR`

Perilaku default:

- scraper akan cek semua file `year-<tahun>.sync-*.jsonl` di `LIVE_SYNC_DIR`
- jika `id` sudah pernah ada, scraper akan `skip`
- ini mencegah duplikasi row yang bisa membuat seed gagal saat insert ke tabel `packages`

Contoh lengkap:

```powershell
npm run sync:inaproc -- `
  --codes 63269137 `
  --out temp\year-2026.sync-00001.jsonl `
  --html-dir temp\raw-html
```

## 5A. Output Format Trio seperti `inaproc-ds/outputs`

Jika Anda ingin output langsung seperti dataset existing:

- `year-2026.part-00002.csv`
- `year-2026.part-00002_priority.json`
- `year-2026.part-00002_failures.csv`

pakai:

```powershell
npm run sync:inaproc:part -- --part 00002 --codes 63269137 --dataset-dir inaproc-ds\outputs
```

Jika Anda tidak tahu `kode`, biarkan script mengambil daftar dari file gagal part yang sama:

```powershell
npm run sync:inaproc:part -- --part 00002 --dataset-dir inaproc-ds\outputs
```

Atau eksplisit:

```powershell
npm run sync:inaproc:part -- --part 00002 --dataset-dir inaproc-ds\outputs --from-failures
```

Script akan membuat 3 file:

```text
inaproc-ds/outputs/year-2026.part-00002.csv
inaproc-ds/outputs/year-2026.part-00002_priority.json
inaproc-ds/outputs/year-2026.part-00002_failures.csv
```

Perilaku default:

- jika `--codes` tidak diberikan, sumber kode diambil dari `year-<tahun>.part-<part>_failures.csv`
- file `.csv`, `_priority.json`, dan `_failures.csv` akan di-merge dengan file lama, bukan dioverwrite kosong
- jika `id` sudah ada di salah satu `year-<tahun>.part-*.csv` dalam folder itu, item akan `skip`
- jika retry berhasil, `id` akan dihapus dari `_failures.csv`
- agar tetap ditulis ulang, tambahkan `--force`

Contoh:

```powershell
npm run sync:inaproc:part -- --part 00002 --codes 63269137,63297396 --dataset-dir inaproc-ds\outputs --force
```

## 6. Upload ke Hosting

Upload file hasil JSONL ke hosting.

Tujuan upload:

```text
<project-root>/data/live-sync/year-2026.sync-00001.jsonl
```

Pastikan `.env` hosting mengarah ke:

```env
LIVE_SYNC_DIR=data/live-sync
```

## 7. Rebuild di Hosting

Setelah file ter-upload:

```bash
npm run db:refresh
```

Jika hosting tidak punya terminal/SSH, panggil URL trigger dari browser:

```text
https://domain-anda/api/admin/refresh/run?token=TOKEN_ANDA
```

Atau jika backend sedang hidup dan Anda bisa memanggil HTTP:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/refresh \
  -H "Authorization: Bearer TOKEN_ANDA"
```

Syarat `.env` hosting:

```env
LIVE_SYNC_DIR=data/live-sync
AUTO_REFRESH_ALLOW_MANUAL_TRIGGER=true
AUTO_REFRESH_ADMIN_TOKEN=TOKEN_ANDA
```

## 8. Uji Kasus Contoh

Kasus contoh `63269137`:

1. hapus row `63269137` dari dataset utama aktif
2. jalankan:
   `npm run db:reset`
3. pastikan package hilang dari DB
4. scrape package itu secara eksternal:
   `npm run sync:inaproc -- --codes 63269137 --out temp\year-2026.sync-00001.jsonl`
5. upload JSONL ke hosting / atau letakkan di `data/live-sync` lokal
6. jalankan:
   `npm run db:refresh`
7. package `63269137` harus muncul lagi dari overlay live-sync

Jika hosting tidak punya terminal, ganti langkah 6 dengan membuka:

```text
https://domain-anda/api/admin/refresh/run?token=TOKEN_ANDA
```

## 9. Catatan Rekomendasi

Untuk produksi, arsitektur paling aman adalah:

- scraper eksternal berjalan di laptop atau VPS Anda
- hasil scraper dikirim manual atau via rsync/scp ke hosting
- hosting hanya melakukan `db:refresh`

Ini jauh lebih realistis dibanding memaksa shared hosting langsung scraping `data.inaproc.id`.

## 10. Mode Incremental SQLite Lokal

Jika Anda tidak ingin `db:reset`, gunakan mode incremental langsung ke SQLite lokal.

Contoh satu kode:

```powershell
npm run db:sync-missing -- --codes 63269137
```

Contoh otomatis dari file gagal part:

```powershell
npm run db:sync-missing -- --part 00123 --dataset-dir inaproc-ds\outputs
```

Contoh batasi percobaan awal:

```powershell
npm run db:sync-missing -- --part 00123 --dataset-dir inaproc-ds\outputs --limit 10
```

Perilaku:

- script cek `packages.id` di SQLite
- jika `id` sudah ada, item di-skip
- jika `id` belum ada, script scrape dari `data.inaproc.id`
- hasil langsung di-upsert ke `packages`, `package_regions`, dan `package_provinces`
- setelah ada data baru, metrics di-rebuild tanpa `db:reset`

Mode ini cocok untuk workflow lokal lalu file `data/dashboard.sqlite` di-upload ke hosting.
