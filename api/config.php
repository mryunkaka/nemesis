<?php
/**
 * MySQL Database Configuration
 * Edit dengan kredensial database Anda di hosting
 */

// Konfigurasi database - ubah sesuai kredensial hosting
define('DB_HOST', 'localhost');
define('DB_NAME', 'nama_database_anda');
define('DB_USER', 'username_database');
define('DB_PASS', 'password_database');
define('DB_CHARSET', 'utf8mb4');

/**
 * Koneksi ke database MySQL
 * @return PDO
 */
function getDB() {
    static $pdo = null;
    
    if ($pdo === null) {
        try {
            $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ];
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
            exit;
        }
    }
    
    return $pdo;
}

/**
 * Ambil asset JSON dari tabel assets
 * @param string $key
 * @return array|null
 */
function getAsset($key) {
    $db = getDB();
    $stmt = $db->prepare("SELECT json FROM assets WHERE `key` = ?");
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    
    if ($row) {
        return json_decode($row['json'], true);
    }
    return null;
}

/**
 * Ambil semua region dengan metrics
 * @return array
 */
function getRegionsWithMetrics() {
    $db = getDB();
    $stmt = $db->query("
        SELECT 
            r.region_key,
            r.code,
            r.province_name,
            r.region_name,
            r.region_type,
            r.display_name,
            COALESCE(rm.total_packages, 0) as total_packages,
            COALESCE(rm.total_priority_packages, 0) as total_priority_packages,
            COALESCE(rm.total_flagged_packages, 0) as total_flagged_packages,
            COALESCE(rm.total_potential_waste, 0) as total_potential_waste,
            COALESCE(rm.total_budget, 0) as total_budget,
            COALESCE(rm.avg_risk_score, 0) as avg_risk_score,
            COALESCE(rm.max_risk_score, 0) as max_risk_score,
            COALESCE(rm.med_severity_packages, 0) as med_severity_packages,
            COALESCE(rm.high_severity_packages, 0) as high_severity_packages,
            COALESCE(rm.absurd_severity_packages, 0) as absurd_severity_packages
        FROM regions r
        LEFT JOIN region_metrics rm ON r.region_key = rm.region_key
        ORDER BY r.province_name, r.region_name
    ");
    return $stmt->fetchAll();
}

/**
 * Ambil semua provinsi dengan metrics
 * @return array
 */
function getProvincesWithMetrics() {
    $db = getDB();
    $stmt = $db->query("
        SELECT 
            p.province_key,
            p.code,
            p.province_name,
            p.display_name,
            COALESCE(pm.total_packages, 0) as total_packages,
            COALESCE(pm.total_priority_packages, 0) as total_priority_packages,
            COALESCE(pm.total_flagged_packages, 0) as total_flagged_packages,
            COALESCE(pm.total_potential_waste, 0) as total_potential_waste,
            COALESCE(pm.total_budget, 0) as total_budget,
            COALESCE(pm.avg_risk_score, 0) as avg_risk_score,
            COALESCE(pm.max_risk_score, 0) as max_risk_score,
            COALESCE(pm.med_severity_packages, 0) as med_severity_packages,
            COALESCE(pm.high_severity_packages, 0) as high_severity_packages,
            COALESCE(pm.absurd_severity_packages, 0) as absurd_severity_packages
        FROM provinces p
        LEFT JOIN province_metrics pm ON p.province_key = pm.province_key
        ORDER BY p.province_name
    ");
    return $stmt->fetchAll();
}
