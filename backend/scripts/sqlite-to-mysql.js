#!/usr/bin/env node
/**
 * SQLite to MySQL Dump Converter
 * Mengubah dump SQLite (dari better-sqlite3) menjadi format MySQL yang bisa diimport via phpMyAdmin
 */

const fs = require("fs");
const path = require("path");

function convertSqliteToMysql(inputFile, outputFile) {
  console.log(`Converting ${path.basename(inputFile)}...`);
  
  let content = fs.readFileSync(inputFile, "utf8");
  
  // Remove SQLite-specific statements
  content = content.replace(/^PRAGMA foreign_keys=OFF;$/gm, "SET FOREIGN_KEY_CHECKS = 0;");
  content = content.replace(/^PRAGMA foreign_keys=ON;$/gm, "SET FOREIGN_KEY_CHECKS = 1;");
  content = content.replace(/^BEGIN TRANSACTION;$/gm, "");
  content = content.replace(/^COMMIT;$/gm, "");
  content = content.replace(/^END TRANSACTION;$/gm, "");
  
  // Convert SQLite hex encoding CAST(X'...' AS TEXT) to MySQL format
  // Pattern: CAST(X'hexdata' AS TEXT) → _binary 'binarydata' or just decode hex
  content = content.replace(/CAST\(X'([0-9A-Fa-f]+)' AS TEXT\)/g, (match, hex) => {
    try {
      const buffer = Buffer.from(hex, 'hex');
      const text = buffer.toString('utf8');
      // Escape single quotes and backslashes for SQL
      const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `'${escaped}'`;
    } catch (e) {
      return match;
    }
  });
  
  // Convert SQLite CAST(X'...' AS INTEGER) - usually for integers stored as hex
  content = content.replace(/CAST\(X'([0-9A-Fa-f]+)' AS INTEGER\)/g, (match, hex) => {
    try {
      const value = parseInt(hex, 16);
      return value.toString();
    } catch (e) {
      return match;
    }
  });
  
  // Convert SQLite CAST(X'...' AS REAL) 
  content = content.replace(/CAST\(X'([0-9A-Fa-f]+)' AS REAL\)/g, (match, hex) => {
    try {
      const buffer = Buffer.from(hex, 'hex');
      const text = buffer.toString('utf8');
      return text;
    } catch (e) {
      return match;
    }
  });
  
  // Remove quotes from integer values in INSERT statements
  // VALUES('123') → VALUES(123) for INTEGER columns
  content = content.replace(/VALUES\('([0-9]+)'\)/g, "VALUES($1)");
  
  // Convert SQLite TEXT PRIMARY KEY to MySQL VARCHAR(255) PRIMARY KEY
  // This is handled by CREATE TABLE replacement below
  
  // Replace SQLite CREATE TABLE syntax with MySQL syntax
  // TEXT → LONGTEXT for large text fields
  // INTEGER → INT
  // REAL → DECIMAL(15,2) or DOUBLE
  
  let lines = content.split('\n');
  let result = [];
  let inCreateTable = false;
  let createTableLines = [];
  
  for (let line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) {
      if (inCreateTable) {
        createTableLines.push(line);
      } else {
        result.push(line);
      }
      continue;
    }
    
    // Start of CREATE TABLE
    if (trimmed.toUpperCase().startsWith('CREATE TABLE')) {
      inCreateTable = true;
      createTableLines = [line];
      continue;
    }
    
    // End of CREATE TABLE
    if (inCreateTable && trimmed === ');') {
      createTableLines.push(line);
      // Process CREATE TABLE block
      const createTable = createTableLines.join('\n');
      const mysqlTable = convertCreateTable(createTable);
      result.push(...mysqlTable.split('\n'));
      inCreateTable = false;
      createTableLines = [];
      continue;
    }
    
    if (inCreateTable) {
      createTableLines.push(line);
    } else {
      result.push(line);
    }
  }
  
  // Add MySQL header
  const header = `-- MySQL dump generated from SQLite
-- Compatible with MySQL 5.7+ and MariaDB 10.2+

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;

`;

  // Add MySQL footer
  const footer = `

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;
`;

  const output = header + result.join('\n') + footer;
  fs.writeFileSync(outputFile, output, "utf8");
  
  console.log(`✓ Converted to ${path.basename(outputFile)}`);
}

function convertCreateTable(sql) {
  // Convert data types
  let converted = sql
    // Replace TEXT with LONGTEXT (for MySQL)
    .replace(/\bTEXT\b/g, 'LONGTEXT')
    // Replace INTEGER with INT
    .replace(/\bINTEGER\b/g, 'INT')
    // Replace REAL with DECIMAL(15,2) for financial data or DOUBLE for general
    .replace(/\bREAL\b/g, 'DOUBLE');
  
  // Note: SQLite's TEXT PRIMARY KEY works in MySQL as VARCHAR or LONGTEXT
  // But for better compatibility, we keep it as is since MySQL 5.7+ supports LONGTEXT with primary key
  
  return converted;
}

// Main execution
const inputFile = process.argv[2] || path.resolve(__dirname, "../../dashboard.sql");
const outputFile = process.argv[3] || path.resolve(__dirname, "../../dashboard-mysql.sql");

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  console.error("\nUsage: node sqlite-to-mysql.js [input.sql] [output.sql]");
  process.exit(1);
}

convertSqliteToMysql(inputFile, outputFile);
console.log("\n✓ Conversion complete!");
console.log(`Import to MySQL with: mysql -u username -p database < ${path.basename(outputFile)}`);
console.log(`Or use phpMyAdmin: Import → Choose File → ${path.basename(outputFile)}`);
