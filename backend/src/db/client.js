const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/autopost.db');
    const { mkdirSync, existsSync } = require('fs');
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
