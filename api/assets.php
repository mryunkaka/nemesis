<?php
/**
 * API Endpoint untuk mengambil asset JSON dari MySQL
 * Digunakan oleh frontend untuk mengambil GeoJSON dan metadata
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

require_once 'config.php';

$key = isset($_GET['key']) ? $_GET['key'] : null;

if (!$key) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing key parameter']);
    exit;
}

// Valid keys yang diizinkan
$validKeys = [
    'audit_geojson',
    'audit_province_geojson', 
    'audit_metadata',
    'audit_regions',
    'audit_provinces',
    'audit_region_metrics',
    'audit_province_metrics',
    'audit_owner_metrics'
];

if (!in_array($key, $validKeys)) {
    http_response_code(404);
    echo json_encode(['error' => 'Asset not found']);
    exit;
}

$data = getAsset($key);

if ($data === null) {
    http_response_code(404);
    echo json_encode(['error' => 'Asset not found']);
    exit;
}

echo json_encode($data);
