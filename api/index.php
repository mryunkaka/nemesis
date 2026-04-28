<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

const LEGEND_COLORS = ['#7b86a3', '#b5a882', '#d4a999', '#8b7332', '#a83c2e'];
const VALID_OWNER_TYPES = ['kabkota', 'provinsi', 'central', 'other'];
const VALID_SEVERITIES = ['low', 'med', 'high', 'absurd'];
const DEFAULT_REGION_PAGE_SIZE = 25;
const MAX_REGION_PAGE_SIZE = 100;

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

function routePath(): string
{
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/api/health', PHP_URL_PATH);
    return is_string($uriPath) ? rtrim($uriPath, '/') ?: '/' : '/';
}

function normalizeNumber(mixed $value): int|float
{
    if ($value === null || $value === '') {
        return 0;
    }

    if (is_int($value) || is_float($value)) {
        return $value;
    }

    $numeric = (string) $value;
    return str_contains($numeric, '.') ? (float) $numeric : (int) $numeric;
}

function escapeLikePattern(string $value): string
{
    return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
}

function clampInteger(mixed $value, int $default, int $minimum, int $maximum): int
{
    $parsed = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsed === false) {
        return $default;
    }

    return max($minimum, min($maximum, $parsed));
}

function parseBooleanQuery(mixed $value): bool
{
    if ($value === null || $value === '') {
        return false;
    }

    $normalized = strtolower(trim((string) $value));
    return in_array($normalized, ['1', 'true', 'yes', 'ya', 'on'], true);
}

function queryOne(string $sql, array $params = []): ?array
{
    $statement = openDatabase()->prepare($sql);
    $statement->execute($params);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

function queryAll(string $sql, array $params = []): array
{
    $statement = openDatabase()->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll();
}

function getJsonAsset(string $key, array $fallback): array
{
    $row = queryOne('SELECT json FROM assets WHERE key = ?', [$key]);
    if (!$row || !isset($row['json'])) {
        return $fallback;
    }

    $decoded = json_decode((string) $row['json'], true);
    return is_array($decoded) ? $decoded : $fallback;
}

function ownerMetricDefinitions(): array
{
    return [
        [
            'key' => 'central',
            'countField' => 'central_packages',
            'priorityField' => 'central_priority_packages',
            'wasteField' => 'central_potential_waste',
            'budgetField' => 'central_budget',
        ],
        [
            'key' => 'provinsi',
            'countField' => 'provincial_packages',
            'priorityField' => 'provincial_priority_packages',
            'wasteField' => 'provincial_potential_waste',
            'budgetField' => 'provincial_budget',
        ],
        [
            'key' => 'kabkota',
            'countField' => 'local_packages',
            'priorityField' => 'local_priority_packages',
            'wasteField' => 'local_potential_waste',
            'budgetField' => 'local_budget',
        ],
        [
            'key' => 'other',
            'countField' => 'other_packages',
            'priorityField' => 'other_priority_packages',
            'wasteField' => 'other_potential_waste',
            'budgetField' => 'other_budget',
        ],
    ];
}

function buildOwnerMetrics(array $row): array
{
    $metrics = [];

    foreach (ownerMetricDefinitions() as $definition) {
        $metrics[$definition['key']] = [
            'totalPackages' => (int) normalizeNumber($row[$definition['countField']] ?? 0),
            'totalPriorityPackages' => (int) normalizeNumber($row[$definition['priorityField']] ?? 0),
            'totalPotentialWaste' => normalizeNumber($row[$definition['wasteField']] ?? 0),
            'totalBudget' => (int) normalizeNumber($row[$definition['budgetField']] ?? 0),
        ];
    }

    return $metrics;
}

function buildProvinceOwnerMetrics(array $row): array
{
    return [
        'central' => ['totalPackages' => 0, 'totalPriorityPackages' => 0, 'totalPotentialWaste' => 0, 'totalBudget' => 0],
        'provinsi' => [
            'totalPackages' => (int) normalizeNumber($row['total_packages'] ?? 0),
            'totalPriorityPackages' => (int) normalizeNumber($row['total_priority_packages'] ?? 0),
            'totalPotentialWaste' => normalizeNumber($row['total_potential_waste'] ?? 0),
            'totalBudget' => (int) normalizeNumber($row['total_budget'] ?? 0),
        ],
        'kabkota' => ['totalPackages' => 0, 'totalPriorityPackages' => 0, 'totalPotentialWaste' => 0, 'totalBudget' => 0],
        'other' => ['totalPackages' => 0, 'totalPriorityPackages' => 0, 'totalPotentialWaste' => 0, 'totalBudget' => 0],
    ];
}

function dominantOwnerType(array $row): ?string
{
    $counts = [
        'central' => (int) normalizeNumber($row['central_packages'] ?? 0),
        'provinsi' => (int) normalizeNumber($row['provincial_packages'] ?? 0),
        'kabkota' => (int) normalizeNumber($row['local_packages'] ?? 0),
        'other' => (int) normalizeNumber($row['other_packages'] ?? 0),
    ];
    arsort($counts);
    $key = array_key_first($counts);
    return ($key !== null && $counts[$key] > 0) ? $key : null;
}

function mapOwnerRow(array $row): array
{
    return [
        'ownerType' => (string) ($row['owner_type'] ?? ''),
        'ownerName' => (string) ($row['owner_name'] ?? ''),
        'totalPackages' => (int) normalizeNumber($row['total_packages'] ?? 0),
        'totalPriorityPackages' => (int) normalizeNumber($row['total_priority_packages'] ?? 0),
        'totalFlaggedPackages' => (int) normalizeNumber($row['total_flagged_packages'] ?? 0),
        'totalPotentialWaste' => normalizeNumber($row['total_potential_waste'] ?? 0),
        'totalBudget' => (int) normalizeNumber($row['total_budget'] ?? 0),
        'severityCounts' => [
            'med' => (int) normalizeNumber($row['med_severity_packages'] ?? 0),
            'high' => (int) normalizeNumber($row['high_severity_packages'] ?? 0),
            'absurd' => (int) normalizeNumber($row['absurd_severity_packages'] ?? 0),
        ],
    ];
}

function mapRegionRow(array $row): array
{
    return [
        'regionKey' => (string) ($row['region_key'] ?? ''),
        'code' => (string) ($row['code'] ?? ''),
        'provinceName' => (string) ($row['province_name'] ?? ''),
        'regionName' => (string) ($row['region_name'] ?? ''),
        'regionType' => (string) ($row['region_type'] ?? ''),
        'displayName' => (string) ($row['display_name'] ?? ''),
        'totalPackages' => (int) normalizeNumber($row['total_packages'] ?? 0),
        'totalPriorityPackages' => (int) normalizeNumber($row['total_priority_packages'] ?? 0),
        'totalFlaggedPackages' => (int) normalizeNumber($row['total_flagged_packages'] ?? 0),
        'totalPotentialWaste' => normalizeNumber($row['total_potential_waste'] ?? 0),
        'totalBudget' => (int) normalizeNumber($row['total_budget'] ?? 0),
        'avgRiskScore' => round((float) normalizeNumber($row['avg_risk_score'] ?? 0), 2),
        'maxRiskScore' => (int) normalizeNumber($row['max_risk_score'] ?? 0),
        'ownerMix' => [
            'central' => (int) normalizeNumber($row['central_packages'] ?? 0),
            'provinsi' => (int) normalizeNumber($row['provincial_packages'] ?? 0),
            'kabkota' => (int) normalizeNumber($row['local_packages'] ?? 0),
            'other' => (int) normalizeNumber($row['other_packages'] ?? 0),
        ],
        'ownerMetrics' => buildOwnerMetrics($row),
        'severityCounts' => [
            'med' => (int) normalizeNumber($row['med_severity_packages'] ?? 0),
            'high' => (int) normalizeNumber($row['high_severity_packages'] ?? 0),
            'absurd' => (int) normalizeNumber($row['absurd_severity_packages'] ?? 0),
        ],
        'dominantOwnerType' => dominantOwnerType($row),
    ];
}

function mapProvinceRow(array $row): array
{
    $totalPackages = (int) normalizeNumber($row['total_packages'] ?? 0);

    return [
        'provinceKey' => (string) ($row['province_key'] ?? ''),
        'code' => (string) ($row['code'] ?? ''),
        'provinceName' => (string) ($row['province_name'] ?? ''),
        'regionName' => (string) ($row['province_name'] ?? ''),
        'regionType' => 'Provinsi',
        'displayName' => (string) ($row['display_name'] ?? ''),
        'totalPackages' => $totalPackages,
        'totalPriorityPackages' => (int) normalizeNumber($row['total_priority_packages'] ?? 0),
        'totalFlaggedPackages' => (int) normalizeNumber($row['total_flagged_packages'] ?? 0),
        'totalPotentialWaste' => normalizeNumber($row['total_potential_waste'] ?? 0),
        'totalBudget' => (int) normalizeNumber($row['total_budget'] ?? 0),
        'avgRiskScore' => round((float) normalizeNumber($row['avg_risk_score'] ?? 0), 2),
        'maxRiskScore' => (int) normalizeNumber($row['max_risk_score'] ?? 0),
        'ownerMix' => [
            'central' => 0,
            'provinsi' => $totalPackages,
            'kabkota' => 0,
            'other' => 0,
        ],
        'ownerMetrics' => buildProvinceOwnerMetrics($row),
        'severityCounts' => [
            'med' => (int) normalizeNumber($row['med_severity_packages'] ?? 0),
            'high' => (int) normalizeNumber($row['high_severity_packages'] ?? 0),
            'absurd' => (int) normalizeNumber($row['absurd_severity_packages'] ?? 0),
        ],
        'dominantOwnerType' => $totalPackages > 0 ? 'provinsi' : null,
    ];
}

function buildLegend(array $values): array
{
    $positiveValues = array_values(array_filter(
        array_map(static fn ($value) => (float) normalizeNumber($value), $values),
        static fn (float $value) => $value > 0
    ));
    sort($positiveValues);

    if ($positiveValues === []) {
        return ['zeroColor' => '#243155', 'ranges' => []];
    }

    $quantiles = [];
    foreach ([0.2, 0.4, 0.6, 0.8, 1.0] as $ratio) {
        $index = (int) min(count($positiveValues) - 1, floor((count($positiveValues) - 1) * $ratio));
        $quantiles[] = $positiveValues[$index];
    }

    $ranges = [];
    $minimum = $positiveValues[0];

    foreach ($quantiles as $index => $maximum) {
        if ($maximum < $minimum) {
            continue;
        }

        if ($ranges !== [] && $maximum === $ranges[count($ranges) - 1]['max']) {
            continue;
        }

        $ranges[] = [
            'key' => 'band-' . ($index + 1),
            'color' => LEGEND_COLORS[min($index, count(LEGEND_COLORS) - 1)],
            'min' => $minimum,
            'max' => $maximum,
        ];

        $minimum = $maximum + 0.01;
    }

    return ['zeroColor' => '#243155', 'ranges' => $ranges];
}

function getNationalSummary(): array
{
    return queryOne(
        'SELECT
            COUNT(*) AS total_packages,
            COALESCE(SUM(is_priority), 0) AS total_priority_packages,
            COALESCE(ROUND(SUM(potential_waste), 2), 0) AS total_potential_waste,
            COALESCE(SUM(COALESCE(budget, 0)), 0) AS total_budget,
            COALESCE(SUM(CASE WHEN mapped_region_count = 0 THEN 1 ELSE 0 END), 0) AS unmapped_packages,
            COALESCE(SUM(CASE WHEN mapped_region_count > 1 THEN 1 ELSE 0 END), 0) AS multi_location_packages
         FROM packages'
    ) ?? [];
}

function getRegionRows(): array
{
    return queryAll(
        'SELECT
            regions.region_key,
            regions.code,
            regions.province_name,
            regions.region_name,
            regions.region_type,
            regions.display_name,
            region_metrics.total_packages,
            region_metrics.total_priority_packages,
            region_metrics.total_flagged_packages,
            region_metrics.total_potential_waste,
            region_metrics.total_budget,
            region_metrics.avg_risk_score,
            region_metrics.max_risk_score,
            region_metrics.central_packages,
            region_metrics.provincial_packages,
            region_metrics.local_packages,
            region_metrics.other_packages,
            region_metrics.central_priority_packages,
            region_metrics.provincial_priority_packages,
            region_metrics.local_priority_packages,
            region_metrics.other_priority_packages,
            region_metrics.central_potential_waste,
            region_metrics.provincial_potential_waste,
            region_metrics.local_potential_waste,
            region_metrics.other_potential_waste,
            region_metrics.central_budget,
            region_metrics.provincial_budget,
            region_metrics.local_budget,
            region_metrics.other_budget,
            region_metrics.med_severity_packages,
            region_metrics.high_severity_packages,
            region_metrics.absurd_severity_packages
         FROM regions
         INNER JOIN region_metrics ON region_metrics.region_key = regions.region_key
         ORDER BY
            region_metrics.total_potential_waste DESC,
            region_metrics.total_priority_packages DESC,
            region_metrics.total_packages DESC,
            regions.display_name ASC'
    );
}

function getProvinceRows(): array
{
    return queryAll(
        'SELECT
            provinces.province_key,
            provinces.code,
            provinces.province_name,
            provinces.display_name,
            province_metrics.total_packages,
            province_metrics.total_priority_packages,
            province_metrics.total_flagged_packages,
            province_metrics.total_potential_waste,
            province_metrics.total_budget,
            province_metrics.avg_risk_score,
            province_metrics.max_risk_score,
            province_metrics.med_severity_packages,
            province_metrics.high_severity_packages,
            province_metrics.absurd_severity_packages
         FROM provinces
         INNER JOIN province_metrics ON province_metrics.province_key = provinces.province_key
         ORDER BY
            province_metrics.total_potential_waste DESC,
            province_metrics.total_priority_packages DESC,
            province_metrics.total_packages DESC,
            provinces.display_name ASC'
    );
}

function getOwnerRows(string $ownerType): array
{
    return queryAll(
        'SELECT
            owner_metrics.owner_type,
            owner_metrics.owner_name,
            owner_metrics.total_packages,
            owner_metrics.total_priority_packages,
            owner_metrics.total_flagged_packages,
            owner_metrics.total_potential_waste,
            owner_metrics.total_budget,
            owner_metrics.med_severity_packages,
            owner_metrics.high_severity_packages,
            owner_metrics.absurd_severity_packages
         FROM owner_metrics
         WHERE owner_metrics.owner_type = ?
         ORDER BY
            owner_metrics.total_potential_waste DESC,
            owner_metrics.total_priority_packages DESC,
            owner_metrics.total_packages DESC,
            owner_metrics.owner_name ASC',
        [$ownerType]
    );
}

function normalizeScopedPackageQuery(array $requestQuery, bool $allowOwnerType = true, bool $allowSeverity = true): array
{
    return [
        'page' => clampInteger($requestQuery['page'] ?? null, 1, 1, PHP_INT_MAX),
        'pageSize' => clampInteger($requestQuery['pageSize'] ?? null, DEFAULT_REGION_PAGE_SIZE, 1, MAX_REGION_PAGE_SIZE),
        'search' => trim((string) ($requestQuery['search'] ?? '')),
        'ownerType' => $allowOwnerType ? trim((string) ($requestQuery['ownerType'] ?? '')) : '',
        'severity' => $allowSeverity ? trim((string) ($requestQuery['severity'] ?? '')) : '',
        'priorityOnly' => parseBooleanQuery($requestQuery['priorityOnly'] ?? null),
    ];
}

function buildPackagesWhereClause(
    string $scopeColumn,
    string $scopeKey,
    array $query,
    ?string $forcedOwnerType = null,
    bool $allowSeverity = true
): array {
    $clauses = [$scopeColumn . ' = ?'];
    $params = [$scopeKey];

    if ($query['search'] !== '') {
        $searchValue = '%' . escapeLikePattern($query['search']) . '%';
        $clauses[] = "(packages.package_name LIKE ? ESCAPE '\\' OR packages.owner_name LIKE ? ESCAPE '\\' OR COALESCE(packages.satker, '') LIKE ? ESCAPE '\\')";
        array_push($params, $searchValue, $searchValue, $searchValue);
    }

    if ($forcedOwnerType !== null) {
        $clauses[] = 'packages.owner_type = ?';
        $params[] = $forcedOwnerType;
    } elseif (in_array($query['ownerType'], VALID_OWNER_TYPES, true)) {
        $clauses[] = 'packages.owner_type = ?';
        $params[] = $query['ownerType'];
    }

    if ($allowSeverity && in_array($query['severity'], VALID_SEVERITIES, true)) {
        $clauses[] = 'packages.severity = ?';
        $params[] = $query['severity'];
    }

    if ($query['priorityOnly']) {
        $clauses[] = 'packages.is_priority = 1';
    }

    return ['sql' => implode(' AND ', $clauses), 'params' => $params];
}

function buildOwnerPackagesWhereClause(string $ownerType, string $ownerName, array $query): array
{
    $clauses = ['packages.owner_type = ?', 'packages.owner_name = ?'];
    $params = [$ownerType, $ownerName];

    if ($query['search'] !== '') {
        $searchValue = '%' . escapeLikePattern($query['search']) . '%';
        $clauses[] = "(packages.package_name LIKE ? ESCAPE '\\' OR packages.owner_name LIKE ? ESCAPE '\\' OR COALESCE(packages.satker, '') LIKE ? ESCAPE '\\')";
        array_push($params, $searchValue, $searchValue, $searchValue);
    }

    if (in_array($query['severity'], VALID_SEVERITIES, true)) {
        $clauses[] = 'packages.severity = ?';
        $params[] = $query['severity'];
    }

    if ($query['priorityOnly']) {
        $clauses[] = 'packages.is_priority = 1';
    }

    return ['sql' => implode(' AND ', $clauses), 'params' => $params];
}

function mapPackageRow(array $row): array
{
    return [
        'id' => (string) ($row['id'] ?? ''),
        'sourceId' => normalizeNumber($row['source_id'] ?? 0),
        'packageName' => (string) ($row['package_name'] ?? ''),
        'ownerName' => (string) ($row['owner_name'] ?? ''),
        'ownerType' => (string) ($row['owner_type'] ?? ''),
        'satker' => (string) ($row['satker'] ?? ''),
        'locationRaw' => (string) ($row['location_raw'] ?? ''),
        'budget' => (int) normalizeNumber($row['budget'] ?? 0),
        'fundingSource' => (string) ($row['funding_source'] ?? ''),
        'procurementType' => (string) ($row['procurement_type'] ?? ''),
        'procurementMethod' => (string) ($row['procurement_method'] ?? ''),
        'selectionDate' => (string) ($row['selection_date'] ?? ''),
        'audit' => [
            'schemaVersion' => (string) ($row['schema_version'] ?? ''),
            'severity' => (string) ($row['severity'] ?? ''),
            'potensiPemborosan' => normalizeNumber($row['potential_waste'] ?? 0),
            'reason' => (string) ($row['reason'] ?? ''),
            'flags' => [
                'isMencurigakan' => ($row['is_mencurigakan'] ?? null) === null ? null : (bool) normalizeNumber($row['is_mencurigakan']),
                'isPemborosan' => ($row['is_pemborosan'] ?? null) === null ? null : (bool) normalizeNumber($row['is_pemborosan']),
            ],
        ],
        'meta' => [
            'isPriority' => (bool) normalizeNumber($row['is_priority'] ?? 0),
            'isFlagged' => (bool) normalizeNumber($row['is_flagged'] ?? 0),
            'riskScore' => (int) normalizeNumber($row['risk_score'] ?? 0),
            'activeTagCount' => (int) normalizeNumber($row['active_tag_count'] ?? 0),
            'mappedRegionCount' => (int) normalizeNumber($row['mapped_region_count'] ?? 0),
        ],
    ];
}

function queryPackagesPage(
    string $scopeTable,
    string $scopeColumn,
    string $scopeKey,
    array $normalizedQuery,
    ?string $forcedOwnerType = null,
    bool $allowSeverity = true
): array {
    $whereClause = buildPackagesWhereClause($scopeColumn, $scopeKey, $normalizedQuery, $forcedOwnerType, $allowSeverity);
    $countRow = queryOne(
        "SELECT COUNT(*) AS total
         FROM {$scopeTable}
         INNER JOIN packages ON packages.id = {$scopeTable}.package_id
         WHERE {$whereClause['sql']}",
        $whereClause['params']
    );

    $totalItems = (int) normalizeNumber($countRow['total'] ?? 0);
    $totalPages = $totalItems > 0 ? (int) ceil($totalItems / $normalizedQuery['pageSize']) : 1;
    $page = min($normalizedQuery['page'], $totalPages);
    $offset = ($page - 1) * $normalizedQuery['pageSize'];

    $rows = queryAll(
        "SELECT
            packages.id,
            packages.source_id,
            packages.schema_version,
            packages.owner_name,
            packages.owner_type,
            packages.satker,
            packages.package_name,
            packages.location_raw,
            packages.budget,
            packages.funding_source,
            packages.procurement_type,
            packages.procurement_method,
            packages.selection_date,
            packages.potential_waste,
            packages.severity,
            packages.reason,
            packages.is_mencurigakan,
            packages.is_pemborosan,
            packages.risk_score,
            packages.active_tag_count,
            packages.is_priority,
            packages.is_flagged,
            packages.mapped_region_count
         FROM {$scopeTable}
         INNER JOIN packages ON packages.id = {$scopeTable}.package_id
         WHERE {$whereClause['sql']}
         ORDER BY
            packages.is_priority DESC,
            packages.potential_waste DESC,
            packages.risk_score DESC,
            COALESCE(packages.budget, 0) DESC,
            packages.inserted_order ASC
         LIMIT ? OFFSET ?",
        [...$whereClause['params'], $normalizedQuery['pageSize'], $offset]
    );

    return [
        'totalItems' => $totalItems,
        'page' => $page,
        'pageSize' => $normalizedQuery['pageSize'],
        'totalPages' => $totalPages,
        'rows' => array_map('mapPackageRow', $rows),
    ];
}

function queryOwnerPackagesPage(string $ownerType, string $ownerName, array $normalizedQuery): array
{
    $whereClause = buildOwnerPackagesWhereClause($ownerType, $ownerName, $normalizedQuery);
    $countRow = queryOne(
        "SELECT COUNT(*) AS total FROM packages WHERE {$whereClause['sql']}",
        $whereClause['params']
    );

    $totalItems = (int) normalizeNumber($countRow['total'] ?? 0);
    $totalPages = $totalItems > 0 ? (int) ceil($totalItems / $normalizedQuery['pageSize']) : 1;
    $page = min($normalizedQuery['page'], $totalPages);
    $offset = ($page - 1) * $normalizedQuery['pageSize'];

    $rows = queryAll(
        "SELECT
            packages.id,
            packages.source_id,
            packages.schema_version,
            packages.owner_name,
            packages.owner_type,
            packages.satker,
            packages.package_name,
            packages.location_raw,
            packages.budget,
            packages.funding_source,
            packages.procurement_type,
            packages.procurement_method,
            packages.selection_date,
            packages.potential_waste,
            packages.severity,
            packages.reason,
            packages.is_mencurigakan,
            packages.is_pemborosan,
            packages.risk_score,
            packages.active_tag_count,
            packages.is_priority,
            packages.is_flagged,
            packages.mapped_region_count
         FROM packages
         WHERE {$whereClause['sql']}
         ORDER BY
            packages.is_priority DESC,
            packages.potential_waste DESC,
            packages.risk_score DESC,
            COALESCE(packages.budget, 0) DESC,
            packages.inserted_order ASC
         LIMIT ? OFFSET ?",
        [...$whereClause['params'], $normalizedQuery['pageSize'], $offset]
    );

    return [
        'totalItems' => $totalItems,
        'page' => $page,
        'pageSize' => $normalizedQuery['pageSize'],
        'totalPages' => $totalPages,
        'rows' => array_map('mapPackageRow', $rows),
    ];
}

function buildBootstrapPayload(): array
{
    $summaryRow = getNationalSummary();
    $regions = array_map('mapRegionRow', getRegionRows());
    $provinces = array_map('mapProvinceRow', getProvinceRows());
    $centralOwners = array_map('mapOwnerRow', getOwnerRows('central'));

    return [
        'summary' => [
            'totalPackages' => (int) normalizeNumber($summaryRow['total_packages'] ?? 0),
            'totalPriorityPackages' => (int) normalizeNumber($summaryRow['total_priority_packages'] ?? 0),
            'totalPotentialWaste' => normalizeNumber($summaryRow['total_potential_waste'] ?? 0),
            'totalBudget' => (int) normalizeNumber($summaryRow['total_budget'] ?? 0),
            'unmappedPackages' => (int) normalizeNumber($summaryRow['unmapped_packages'] ?? 0),
            'multiLocationPackages' => (int) normalizeNumber($summaryRow['multi_location_packages'] ?? 0),
        ],
        'legend' => buildLegend(array_map(static fn (array $region) => $region['totalPotentialWaste'], $regions)),
        'geo' => getJsonAsset('audit_geojson', ['type' => 'FeatureCollection', 'features' => []]),
        'regions' => $regions,
        'provinceView' => [
            'legend' => buildLegend(array_map(static fn (array $province) => $province['totalPotentialWaste'], $provinces)),
            'geo' => getJsonAsset('audit_province_geojson', ['type' => 'FeatureCollection', 'features' => []]),
            'provinces' => $provinces,
        ],
        'ownerLists' => [
            'central' => $centralOwners,
        ],
    ];
}

function getRegionPackages(string $regionKey, array $requestQuery): ?array
{
    $regionRow = queryOne(
        'SELECT
            regions.region_key,
            regions.code,
            regions.province_name,
            regions.region_name,
            regions.region_type,
            regions.display_name,
            region_metrics.total_packages,
            region_metrics.total_priority_packages,
            region_metrics.total_flagged_packages,
            region_metrics.total_potential_waste,
            region_metrics.total_budget,
            region_metrics.avg_risk_score,
            region_metrics.max_risk_score,
            region_metrics.central_packages,
            region_metrics.provincial_packages,
            region_metrics.local_packages,
            region_metrics.other_packages,
            region_metrics.central_priority_packages,
            region_metrics.provincial_priority_packages,
            region_metrics.local_priority_packages,
            region_metrics.other_priority_packages,
            region_metrics.central_potential_waste,
            region_metrics.provincial_potential_waste,
            region_metrics.local_potential_waste,
            region_metrics.other_potential_waste,
            region_metrics.central_budget,
            region_metrics.provincial_budget,
            region_metrics.local_budget,
            region_metrics.other_budget,
            region_metrics.med_severity_packages,
            region_metrics.high_severity_packages,
            region_metrics.absurd_severity_packages
         FROM regions
         INNER JOIN region_metrics ON region_metrics.region_key = regions.region_key
         WHERE regions.region_key = ?',
        [$regionKey]
    );

    if (!$regionRow) {
        return null;
    }

    $normalizedQuery = normalizeScopedPackageQuery($requestQuery);
    $pageResult = queryPackagesPage('package_regions', 'package_regions.region_key', $regionKey, $normalizedQuery);

    return [
        'region' => mapRegionRow($regionRow),
        'summary' => [
            'totalItems' => $pageResult['totalItems'],
            'filteredItems' => $pageResult['totalItems'],
        ],
        'pagination' => [
            'page' => $pageResult['page'],
            'pageSize' => $pageResult['pageSize'],
            'totalItems' => $pageResult['totalItems'],
            'totalPages' => $pageResult['totalPages'],
        ],
        'filters' => [
            'search' => $normalizedQuery['search'],
            'ownerType' => $normalizedQuery['ownerType'],
            'severity' => $normalizedQuery['severity'],
            'priorityOnly' => $normalizedQuery['priorityOnly'],
        ],
        'items' => $pageResult['rows'],
    ];
}

function getProvincePackages(string $provinceKey, array $requestQuery): ?array
{
    $provinceRow = queryOne(
        'SELECT
            provinces.province_key,
            provinces.code,
            provinces.province_name,
            provinces.display_name,
            province_metrics.total_packages,
            province_metrics.total_priority_packages,
            province_metrics.total_flagged_packages,
            province_metrics.total_potential_waste,
            province_metrics.total_budget,
            province_metrics.avg_risk_score,
            province_metrics.max_risk_score,
            province_metrics.med_severity_packages,
            province_metrics.high_severity_packages,
            province_metrics.absurd_severity_packages
         FROM provinces
         INNER JOIN province_metrics ON province_metrics.province_key = provinces.province_key
         WHERE provinces.province_key = ?',
        [$provinceKey]
    );

    if (!$provinceRow) {
        return null;
    }

    $normalizedQuery = normalizeScopedPackageQuery($requestQuery, false);
    $pageResult = queryPackagesPage(
        'package_provinces',
        'package_provinces.province_key',
        $provinceKey,
        $normalizedQuery,
        'provinsi'
    );

    return [
        'province' => mapProvinceRow($provinceRow),
        'summary' => [
            'totalItems' => $pageResult['totalItems'],
            'filteredItems' => $pageResult['totalItems'],
        ],
        'pagination' => [
            'page' => $pageResult['page'],
            'pageSize' => $pageResult['pageSize'],
            'totalItems' => $pageResult['totalItems'],
            'totalPages' => $pageResult['totalPages'],
        ],
        'filters' => [
            'search' => $normalizedQuery['search'],
            'severity' => $normalizedQuery['severity'],
            'priorityOnly' => $normalizedQuery['priorityOnly'],
        ],
        'items' => $pageResult['rows'],
    ];
}

function getOwnerPackages(array $requestQuery): ?array
{
    $ownerType = trim((string) ($requestQuery['ownerType'] ?? ''));
    $ownerName = trim((string) ($requestQuery['ownerName'] ?? ''));

    if (!in_array($ownerType, VALID_OWNER_TYPES, true) || $ownerName === '') {
        return null;
    }

    $ownerRow = queryOne(
        'SELECT
            owner_metrics.owner_type,
            owner_metrics.owner_name,
            owner_metrics.total_packages,
            owner_metrics.total_priority_packages,
            owner_metrics.total_flagged_packages,
            owner_metrics.total_potential_waste,
            owner_metrics.total_budget,
            owner_metrics.med_severity_packages,
            owner_metrics.high_severity_packages,
            owner_metrics.absurd_severity_packages
         FROM owner_metrics
         WHERE owner_metrics.owner_type = ?
           AND owner_metrics.owner_name = ?',
        [$ownerType, $ownerName]
    );

    if (!$ownerRow) {
        return null;
    }

    $normalizedQuery = normalizeScopedPackageQuery($requestQuery, false);
    $pageResult = queryOwnerPackagesPage($ownerType, $ownerName, $normalizedQuery);

    return [
        'owner' => mapOwnerRow($ownerRow),
        'summary' => [
            'totalItems' => $pageResult['totalItems'],
            'filteredItems' => $pageResult['totalItems'],
        ],
        'pagination' => [
            'page' => $pageResult['page'],
            'pageSize' => $pageResult['pageSize'],
            'totalItems' => $pageResult['totalItems'],
            'totalPages' => $pageResult['totalPages'],
        ],
        'filters' => [
            'search' => $normalizedQuery['search'],
            'severity' => $normalizedQuery['severity'],
            'priorityOnly' => $normalizedQuery['priorityOnly'],
        ],
        'items' => $pageResult['rows'],
    ];
}

try {
    $path = routePath();

    if ($path === '/api/health') {
        jsonResponse(['status' => 'ok']);
    }

    if ($path === '/api/bootstrap') {
        jsonResponse(buildBootstrapPayload());
    }

    if (preg_match('#^/api/regions/([^/]+)/packages$#', $path, $matches) === 1) {
        $payload = getRegionPackages(urldecode($matches[1]), $_GET);
        if ($payload === null) {
            jsonResponse(['error' => 'Region not found'], 404);
        }
        jsonResponse($payload);
    }

    if (preg_match('#^/api/provinces/([^/]+)/packages$#', $path, $matches) === 1) {
        $payload = getProvincePackages(urldecode($matches[1]), $_GET);
        if ($payload === null) {
            jsonResponse(['error' => 'Province not found'], 404);
        }
        jsonResponse($payload);
    }

    if ($path === '/api/owners/packages') {
        $payload = getOwnerPackages($_GET);
        if ($payload === null) {
            $ownerType = trim((string) ($_GET['ownerType'] ?? ''));
            $ownerName = trim((string) ($_GET['ownerName'] ?? ''));
            if ($ownerType === '' || $ownerName === '') {
                jsonResponse(['error' => 'ownerType and ownerName are required'], 400);
            }
            jsonResponse(['error' => 'Owner not found'], 404);
        }
        jsonResponse($payload);
    }

    jsonResponse(['error' => 'Not found'], 404);
} catch (Throwable $error) {
    jsonResponse([
        'error' => 'Internal server error',
        'detail' => $error->getMessage(),
    ], 500);
}

