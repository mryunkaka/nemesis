<?php

// 1. Sesuaikan path ke folder project nemesis kamu
$repo = "/home/hark8423/public_html/nemesis";

// 2. Sesuaikan file tempat log rincian deploy (agar lognya terpisah dan rapi)
$log  = "/home/hark8423/git-deploy-nemesis.log";

// Pindah perintah eksekusi ke dalam folder repository Git
chdir($repo);

// Cek kode unik commit yang sekarang
$old = trim(shell_exec("git rev-parse HEAD"));

// Eksekusi penarikan data dari GitHub cabang 'main'
$output = shell_exec("git pull origin main 2>&1");

// Cek kode unik commit setelah pull
$new = trim(shell_exec("git rev-parse HEAD"));

// Jika ada perubahan (ada update baru yang masuk)
if ($old !== $new) {
    // Ambil histori siapa yang merubah dan apa catatan (commit)-nya
    $commits = shell_exec("git log $old..$new --pretty=format:'%h | %an | %s'");

    // Set zona waktu agar log sesuai waktu Indonesia
    date_default_timezone_set("Asia/Jakarta");
    $date = date("Y-m-d H:i:s");

    // Catat satu per satu ke dalam file .log
    foreach (explode("\n", trim($commits)) as $commit) {
        if (!empty(trim($commit))) {
            file_put_contents($log, "[$date] Deploy $commit\n", FILE_APPEND);
        }
    }

    // Copy isi folder frontend ke root (untuk static mode)
    if (is_dir($repo . "/frontend")) {
        // Copy index.html
        if (file_exists($repo . "/frontend/index.html")) {
            copy($repo . "/frontend/index.html", $repo . "/index.html");
        }

        // Copy folder assets
        if (is_dir($repo . "/frontend/assets")) {
            shell_exec("cp -r " . $repo . "/frontend/assets/* " . $repo . "/assets/ 2>&1");
        }

        // Copy folder data (jika ada)
        if (is_dir($repo . "/frontend/data")) {
            shell_exec("cp -r " . $repo . "/frontend/data/* " . $repo . "/data/ 2>&1");
        }

        file_put_contents($log, "[$date] Copied frontend files to root\n", FILE_APPEND);
    }
} else {
    // Opsional: hapus komentar di bawah ini jika kamu ingin mencatat bahwa Cron Job dicek tapi kosong
    // file_put_contents($log, "[" . date("Y-m-d H:i:s") . "] Checked - No new commits.\n", FILE_APPEND);
}

echo "Proses cek Git selesai.";
