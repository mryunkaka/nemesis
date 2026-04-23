<?php
/**
 * API Endpoint untuk mengambil data provinsi dengan metrics dari MySQL
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

require_once 'config.php';

$provinceKey = isset($_GET['key']) ? $_GET['key'] : null;

if ($provinceKey) {
    // Ambil detail satu provinsi
    $db = getDB();
    $stmt = $db->prepare("
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
        WHERE p.province_key = ?
        LIMIT 1
    ");
    $stmt->execute([$provinceKey]);
    $province = $stmt->fetch();
    
    if (!$province) {
        http_response_code(404);
        echo json_encode(['error' => 'Province not found']);
        exit;
    }
    
    echo json_encode($province);
} else {
    // Ambil semua provinsi
    $provinces = getProvincesWithMetrics();
    echo json_encode($provinces);
}
