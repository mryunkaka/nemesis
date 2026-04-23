<?php
/**
 * SQLite to MySQL Dump Converter
 * Konversi dashboard.sql (SQLite) ke format MySQL
 * 
 * Cara pakai:
 * php sqlite-to-mysql.php ../../dashboard.sql ../../dashboard-mysql.sql
 */

if ($argc < 3) {
    echo "Usage: php sqlite-to-mysql.php <input.sql> <output.sql>\n";
    exit(1);
}

$inputFile = $argv[1];
$outputFile = $argv[2];

if (!file_exists($inputFile)) {
    echo "Error: File not found: $inputFile\n";
    exit(1);
}

echo "Converting " . basename($inputFile) . "...\n";

$input = fopen($inputFile, 'r');
$output = fopen($outputFile, 'w');

// Write MySQL header
fwrite($output, "-- MySQL dump generated from SQLite\n");
fwrite($output, "-- Compatible with MySQL 5.7+ and MariaDB 10.2+\n\n");
fwrite($output, "SET FOREIGN_KEY_CHECKS = 0;\n");
fwrite($output, "SET SQL_MODE = \"NO_AUTO_VALUE_ON_ZERO\";\n");
fwrite($output, "SET AUTOCOMMIT = 0;\n");
fwrite($output, "START TRANSACTION;\n\n");

$lineCount = 0;
$inCreateTable = false;
$createTableBuffer = [];

while (($line = fgets($input)) !== false) {
    $lineCount++;
    $trimmed = trim($line);
    
    // Skip SQLite-specific statements
    if ($trimmed === 'PRAGMA foreign_keys=OFF;' || 
        $trimmed === 'BEGIN TRANSACTION;' || 
        $trimmed === 'END TRANSACTION;' ||
        $trimmed === 'COMMIT;') {
        continue;
    }
    
    // Handle CREATE TABLE block
    if (stripos($trimmed, 'CREATE TABLE') === 0) {
        $inCreateTable = true;
        $createTableBuffer = [$line];
        continue;
    }
    
    if ($inCreateTable) {
        $createTableBuffer[] = $line;
        if ($trimmed === ');') {
            // End of CREATE TABLE, process it
            $createTable = implode('', $createTableBuffer);
            $mysqlTable = convertCreateTable($createTable);
            fwrite($output, $mysqlTable);
            $inCreateTable = false;
            $createTableBuffer = [];
        }
        continue;
    }
    
    // Process regular lines (INSERT statements, etc)
    if ($trimmed !== '') {
        $processed = processLine($line);
        fwrite($output, $processed);
    }
    
    if ($lineCount % 10000 === 0) {
        echo "  Processed " . number_format($lineCount) . " lines...\n";
    }
}

fclose($input);

// Write MySQL footer
fwrite($output, "\nCOMMIT;\n");
fwrite($output, "SET FOREIGN_KEY_CHECKS = 1;\n");

fclose($output);

echo "\n✓ Conversion complete! Total lines: " . number_format($lineCount) . "\n";
echo "Output file: $outputFile\n\n";

echo "Langkah selanjutnya:\n";
echo "  1. Login phpMyAdmin di hosting Anda\n";
echo "  2. Buat database baru (contoh: audit_lkpp)\n";
echo "  3. Tab Import → Choose File → Pilih " . basename($outputFile) . "\n";
echo "  4. Klik Go\n";

function processLine($line) {
    // Convert SQLite hex encoding CAST(X'...' AS TEXT) to MySQL string
    $line = preg_replace_callback(
        "/CAST\(X'([0-9A-Fa-f]+)' AS TEXT\)/",
        function($matches) {
            $hex = $matches[1];
            $text = hex2bin($hex);
            // Escape single quotes and backslashes for SQL
            $escaped = str_replace(['\\', "'"], ['\\\\', "\\'"], $text);
            return "'$escaped'";
        },
        $line
    );
    
    // Convert SQLite CAST(X'...' AS INTEGER)
    $line = preg_replace_callback(
        "/CAST\(X'([0-9A-Fa-f]+)' AS INTEGER\)/",
        function($matches) {
            return hexdec($matches[1]);
        },
        $line
    );
    
    // Convert SQLite CAST(X'...' AS REAL)
    $line = preg_replace_callback(
        "/CAST\(X'([0-9A-Fa-f]+)' AS REAL\)/",
        function($matches) {
            $hex = $matches[1];
            $text = hex2bin($hex);
            return $text;
        },
        $line
    );
    
    return $line;
}

function convertCreateTable($sql) {
    // Convert data types for MySQL
    $sql = preg_replace('/\bTEXT\b/', 'LONGTEXT', $sql);
    $sql = preg_replace('/\bINTEGER\b/', 'INT', $sql);
    $sql = preg_replace('/\bREAL\b/', 'DOUBLE', $sql);
    return $sql;
}
