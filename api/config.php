<?php

declare(strict_types=1);

const APP_ROOT = __DIR__ . DIRECTORY_SEPARATOR . '..';

function loadEnvFile(string $filePath): array
{
    if (!is_file($filePath)) {
        return [];
    }

    $values = [];
    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

    if ($lines === false) {
        return [];
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);

        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $separatorPosition = strpos($trimmed, '=');
        if ($separatorPosition === false) {
            continue;
        }

        $key = trim(substr($trimmed, 0, $separatorPosition));
        $value = trim(substr($trimmed, $separatorPosition + 1));

        if ($key === '') {
            continue;
        }

        if (
            strlen($value) >= 2 &&
            (($value[0] === '"' && $value[strlen($value) - 1] === '"') ||
                ($value[0] === "'" && $value[strlen($value) - 1] === "'"))
        ) {
            $value = substr($value, 1, -1);
        }

        $values[$key] = $value;
    }

    return $values;
}

function envValue(string $key, ?string $default = null): ?string
{
    static $loaded = null;

    if ($loaded === null) {
        $loaded = loadEnvFile(APP_ROOT . DIRECTORY_SEPARATOR . '.env');
    }

    $runtimeValue = getenv($key);
    if ($runtimeValue !== false) {
        return $runtimeValue;
    }

    if (array_key_exists($key, $loaded)) {
        return $loaded[$key];
    }

    return $default;
}

function resolveFromRoot(string $path): string
{
    if ($path === '') {
        return APP_ROOT;
    }

    if (preg_match('/^(?:[A-Za-z]:[\\\\\\/]|\/)/', $path) === 1) {
        return $path;
    }

    return APP_ROOT . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path);
}

function jsonResponse(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: ' . (envValue('CORS_ORIGIN', '*') ?: '*'));
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Admin-Token');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function openDatabase(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $configuredPath = envValue('SQLITE_PATH', 'data/dashboard.sqlite') ?? 'data/dashboard.sqlite';
    $databasePath = resolveFromRoot($configuredPath);

    if (!is_file($databasePath)) {
        jsonResponse([
            'error' => 'SQLite database file was not found.',
            'path' => $databasePath,
        ], 500);
    }

    try {
        $pdo = new PDO('sqlite:' . $databasePath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
    } catch (Throwable $error) {
        jsonResponse([
            'error' => 'Failed to open SQLite database.',
            'detail' => $error->getMessage(),
        ], 500);
    }

    return $pdo;
}

