# Panduan Deploy ke Shared Hosting

## Cara Menjalankan Secara Lokal (Dengan Backend)

### 1. Setup Database
```bash
cd backend
npm install
npm run db:reset
```

### 2. Jalankan Backend
```bash
cd backend
npm start
```
Backend akan berjalan di `http://127.0.0.1:3000`

### 3. Jalankan Frontend
```bash
cd frontend
python3 -m http.server 8080
```
Frontend akan berjalan di `http://127.0.0.1:8080`

Buka `http://127.0.0.1:8080` di browser untuk mengakses aplikasi.

---

## Cara Deploy ke Shared Hosting (Tanpa SSH/Terminal)

### Langkah 1: Export Database ke JSON Statis

Jalankan perintah berikut dari direktori `backend`:

```bash
cd backend
npm run export:static
```

Perintah ini akan:
- Export data dari SQLite ke format JSON
- Menyimpan file di `frontend/data/`
- Membuat file:
  - `data/bootstrap.json` - Data utama dashboard
  - `data/regions/*.json` - Data paket per kabupaten/kota
  - `data/provinces/*.json` - Data paket per provinsi
  - `data/owners/*.json` - Data paket per kementerian/lembaga

### Langkah 2: Upload ke Shared Hosting

Upload seluruh isi folder `frontend` ke shared hosting Anda menggunakan:
- File Manager (cPanel/DirectAdmin)
- FTP (FileZilla)
- Web-based file manager

**File yang perlu di-upload:**
- `index.html`
- `assets/` (seluruh folder)
- `data/` (folder yang berisi JSON dari export)

### Langkah 3: Selesai

Aplikasi akan otomatis berjalan dalam **static mode** karena mendeteksi bahwa hostname bukan `127.0.0.1` atau `localhost`.

Frontend akan:
- Membaca data dari file JSON lokal
- Tidak memerlukan backend server
- Berjalan sepenuhnya di browser

---

## Auto Deploy dengan Cron Job PHP (Rekomendasi)

Untuk deploy otomatis setiap commit ke branch `main`, gunakan cron job PHP.

### Setup Cron Job

1. **Upload file git-deploy.php:**
   - Upload file `git-deploy.php` ke hosting
   - Lokasi: di luar public_html (misal: `/home/hark8423/git-deploy-nemesis.php`)

2. **Setup Cron Job di cPanel:**
   - Buka cPanel → Cron Jobs
   - Tambahkan cron job baru:
     - Minute: `*/5` (setiap 5 menit)
     - Command: `php /home/hark8423/git-deploy-nemesis.php`

3. **Sesuaikan path di git-deploy.php:**
   ```php
   $repo = "/home/hark8423/public_html/nemesis";
   $log  = "/home/hark8423/git-deploy-nemesis.log";
   ```

4. **Push ke main untuk trigger deploy:**
   ```bash
   git add .
   git commit -m "Update data"
   git push origin main
   ```

Cron job akan mengecek setiap 5 menit dan otomatis pull update dari GitHub.

### Catatan

- Cron job akan menjalankan `git pull` dari GitHub
- Setelah pull, otomatis menyalin isi folder `frontend/` ke root hosting (index.html, assets/, data/)
- Struktur di GitHub tetap `frontend/` untuk development, tapi di hosting akan otomatis di-copy ke root
- Pastikan path di git-deploy.php sesuai dengan hosting Anda
- Monitor log di file yang ditentukan di `$log`
- Export database ke JSON perlu dilakukan manual sebelum push:
  ```bash
  cd backend
  npm run export:static
  git add frontend/data/
  git commit -m "Update data"
  git push origin main
  ```

---

## Catatan Penting

### Perbedaan Mode

**Mode Development (Local):**
- Frontend mengambil data dari API backend (`http://127.0.0.1:3000/api`)
- Perlu backend server berjalan
- Data real-time dari SQLite

**Mode Production (Shared Hosting):**
- Frontend mengambil data dari file JSON statis
- Tidak perlu backend server
- Data statis (perlu re-export jika ada update data)

### Update Data di Shared Hosting

Jika ada perubahan data di database:

1. Export ulang ke JSON:
   ```bash
   cd backend
   npm run export:static
   ```

2. Upload ulang folder `data/` ke shared hosting

3. Refresh browser (cache mungkin perlu di-clear)

### Limitasi Static Mode

- **Pagination**: Di static mode, pagination terbatas (1000 paket per halaman)
- **Filter**: Filter pencarian berjalan di client-side (JavaScript)
- **Update**: Perlu re-export manual jika data berubah

### Mode Hybrid (Opsional)

Jika ingin menggunakan backend di production (VPS/dedicated server):

1. Upload backend ke server
2. Install dependencies: `npm install`
3. Jalankan backend: `npm start` (atau gunakan PM2 untuk production)
4. Upload frontend
5. Set `window.DASHBOARD_API_BASE_URL` di `index.html` ke URL backend Anda

---

## Troubleshooting

### Error "Failed to load dashboard"

- Pastikan folder `data/` sudah di-upload
- Pastikan file `data/bootstrap.json` ada
- Cek browser console untuk error detail

### Data tidak muncul

- Pastikan export JSON berhasil (cek file di `frontend/data/`)
- Pastikan semua file JSON terupload dengan benar
- Clear browser cache

### Error saat export

- Pastikan database sudah di-reset: `npm run db:reset`
- Pastikan file `dashboard.sqlite` ada di `backend/data/`
