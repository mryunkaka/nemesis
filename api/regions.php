<?php
/**
 * API Endpoint untuk mengambil data region dengan metrics dari MySQL
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

require_once 'config.php';

$regionKey = isset($_GET['key']) ? $_GET['key'] : null;

if ($regionKey) {
    // Ambil detail satu region
    $db = getDB();
    $stmt = $db->prepare("
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
        WHERE r.region_key = ?
        LIMIT 1
    ");
    $stmt->execute([$regionKey]);
    $region = $stmt->fetch();
    
    if (!$region) {
        http_response_code(404);
        echo json_encode(['error' => 'Region not found']);
        exit;
    }
    
    echo json_encode($region);
} else {
    // Ambil semua region
    $regions = getRegionsWithMetrics();
    echo json_encode($regions);
}
