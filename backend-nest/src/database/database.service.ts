import { Injectable, OnModuleInit } from '@nestjs/common';
import Database = require('better-sqlite3');
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private db: Database.Database | null = null;

  getDb(): Database.Database {
    if (!this.db) {
      const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/autopost.db');
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const database = new Database(dbPath);
      database.pragma('journal_mode = WAL');
      database.pragma('foreign_keys = ON');
      this.db = database;
    }
    return this.db as Database.Database;
  }

  onModuleInit() {
    this.runMigrations();
  }

  private runMigrations() {
    const db = this.getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS proxy (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('socks5','socks4','http-connect')),
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        login TEXT,
        password TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS vm (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        libvirt_domain TEXT NOT NULL UNIQUE,
        mac TEXT,
        proxy_id TEXT REFERENCES proxy(id),
        adb_address TEXT,
        android_id TEXT,
        status TEXT DEFAULT 'stopped' CHECK(status IN ('stopped','running','creating','error')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS profile (
        id TEXT PRIMARY KEY,
        vm_id TEXT NOT NULL REFERENCES vm(id) ON DELETE CASCADE,
        instagram_username TEXT,
        instagram_authorized INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(vm_id)
      );
      CREATE TABLE IF NOT EXISTS scheduled_post (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        media_path TEXT NOT NULL,
        caption TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','assigned','publishing','published','failed','cancelled')),
        assigned_at TEXT,
        published_at TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        vm_id TEXT NOT NULL,
        action TEXT NOT NULL,
        message TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_vm_proxy ON vm(proxy_id);
      CREATE INDEX IF NOT EXISTS idx_profile_vm ON profile(vm_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_status_at ON scheduled_post(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_profile ON scheduled_post(profile_id);
    `);
  }
}
