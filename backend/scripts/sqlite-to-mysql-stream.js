#!/usr/bin/env node
/**
 * SQLite to MySQL Dump Converter - Streaming Version
 * Untuk file besar (dashboard.sql ~9MB+)
 */

const fs = require("fs");
const readline = require("readline");
const path = require("path");

function convertHexToText(hex) {
  try {
    const buffer = Buffer.from(hex, 'hex');
    const text = buffer.toString('utf8');
    // Escape single quotes and backslashes for SQL
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  } catch (e) {
    return hex;
  }
}

function processLine(line) {
  let processed = line;
  
  // Convert SQLite hex encoding CAST(X'...' AS TEXT) to MySQL string
  processed = processed.replace(/CAST\(X'([0-9A-Fa-f]+)' AS TEXT\)/g, (match, hex) => {
    const text = convertHexToText(hex);
    return `'${text}'`;
  });
  
  // Convert SQLite CAST(X'...' AS INTEGER)
  processed = processed.replace(/CAST\(X'([0-9A-Fa-f]+)' AS INTEGER\)/g, (match, hex) => {
    try {
      return parseInt(hex, 16).toString();
    } catch (e) {
      return match;
    }
  });
  
  // Convert SQLite CAST(X'...' AS REAL)
  processed = processed.replace(/CAST\(X'([0-9A-Fa-f]+)' AS REAL\)/g, (match, hex) => {
    try {
      const buffer = Buffer.from(hex, 'hex');
      const text = buffer.toString('utf8');
      return text;
    } catch (e) {
      return match;
    }
  });
  
  return processed;
}

function convertCreateTable(sql) {
  // Convert data types for MySQL
  return sql
    .replace(/\bTEXT\b/g, 'LONGTEXT')
    .replace(/\bINTEGER\b/g, 'INT')
    .replace(/\bREAL\b/g, 'DOUBLE');
}

async function convertSqliteToMysql(inputFile, outputFile) {
  console.log(`Converting ${path.basename(inputFile)}...`);
  console.log(`Output: ${path.basename(outputFile)}`);
  
  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const output = fs.createWriteStream(outputFile);
  
  // Write MySQL header
  output.write(`-- MySQL dump generated from SQLite\n`);
  output.write(`-- Compatible with MySQL 5.7+ and MariaDB 10.2+\n\n`);
  output.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
  output.write(`SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n`);
  output.write(`SET AUTOCOMMIT = 0;\n`);
  output.write(`START TRANSACTION;\n\n`);
  
  let lineCount = 0;
  let inCreateTable = false;
  let createTableBuffer = [];
  
  for await (const line of rl) {
    lineCount++;
    const trimmed = line.trim();
    
    // Skip SQLite-specific statements
    if (trimmed === 'PRAGMA foreign_keys=OFF;' || 
        trimmed === 'BEGIN TRANSACTION;' || 
        trimmed === 'END TRANSACTION;' ||
        trimmed === 'COMMIT;') {
      continue;
    }
    
    // Handle CREATE TABLE block
    if (trimmed.toUpperCase().startsWith('CREATE TABLE')) {
      inCreateTable = true;
      createTableBuffer = [line];
      continue;
    }
    
    if (inCreateTable) {
      createTableBuffer.push(line);
      if (trimmed === ');') {
        // End of CREATE TABLE, process it
        const createTable = createTableBuffer.join('\n');
        const mysqlTable = convertCreateTable(createTable);
        output.write(mysqlTable + '\n');
        inCreateTable = false;
        createTableBuffer = [];
      }
      continue;
    }
    
    // Process regular lines (INSERT statements, etc)
    if (trimmed) {
      const processed = processLine(line);
      output.write(processed + '\n');
    }
    
    if (lineCount % 10000 === 0) {
      console.log(`  Processed ${lineCount.toLocaleString()} lines...`);
    }
  }
  
  // Write MySQL footer
  output.write(`\nCOMMIT;\n`);
  output.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  
  output.end();
  console.log(`\n✓ Conversion complete! Total lines: ${lineCount.toLocaleString()}`);
  console.log(`\nFile output: ${outputFile}`);
  console.log(`\nUntuk import ke MySQL:`);
  console.log(`  1. Login phpMyAdmin di hosting Anda`);
  console.log(`  2. Buat database baru (contoh: audit_lkpp)`);
  console.log(`  3. Tab Import → Choose File → Pilih ${path.basename(outputFile)}`);
  console.log(`  4. Klik Go`);
}

// Main execution
const inputFile = process.argv[2] || path.resolve(__dirname, "../../dashboard.sql");
const outputFile = process.argv[3] || path.resolve(__dirname, "../../dashboard-mysql.sql");

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  console.error("\nUsage: node sqlite-to-mysql-stream.js [input.sql] [output.sql]");
  process.exit(1);
}

convertSqliteToMysql(inputFile, outputFile).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
