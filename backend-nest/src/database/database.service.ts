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
        social_network TEXT DEFAULT 'instagram',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(vm_id, social_network)
      );
      CREATE TABLE IF NOT EXISTS scheduled_post (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        media_path TEXT NOT NULL,
        title TEXT,
        caption TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','assigned','publishing','published','simulated','failed','cancelled')),
        assigned_at TEXT,
        published_at TEXT,
        post_url TEXT,
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
      CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY);
    `);
    this.migrateScheduledPostSimulatedStatus(db);
    this.migrateVmInstagramInstalled(db);
    this.migrateScheduledPostUrl(db);
    this.migrateProfileSocialNetwork(db);
    this.migrateVmYoutubeInstalled(db);
    this.migrateVmVkInstalled(db);
    this.migrateProfileMultiPerVm(db);
    this.migrateScheduledPostTitle(db);
  }

  private migrateVmInstagramInstalled(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('vm_instagram_installed');
    if (exists) return;
    db.exec(`
      ALTER TABLE vm ADD COLUMN instagram_installed INTEGER DEFAULT 0;
      INSERT INTO _migrations (name) VALUES ('vm_instagram_installed');
    `);
  }

  private migrateProfileSocialNetwork(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('profile_social_network');
    if (exists) return;
    const columns = db.prepare('PRAGMA table_info(profile)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'social_network')) {
      db.exec(`ALTER TABLE profile ADD COLUMN social_network TEXT DEFAULT 'instagram';`);
    }
    db.exec(`INSERT INTO _migrations (name) VALUES ('profile_social_network');`);
  }

  /** Несколько профилей на VM (Instagram + YouTube): UNIQUE(vm_id, social_network). */
  private migrateProfileMultiPerVm(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('profile_multi_per_vm');
    if (exists) return;
    const columns = db.prepare('PRAGMA table_info(profile)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'social_network')) {
      db.exec(`ALTER TABLE profile ADD COLUMN social_network TEXT DEFAULT 'instagram';`);
    }
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE profile_new (
        id TEXT PRIMARY KEY,
        vm_id TEXT NOT NULL REFERENCES vm(id) ON DELETE CASCADE,
        instagram_username TEXT,
        instagram_authorized INTEGER DEFAULT 0,
        social_network TEXT DEFAULT 'instagram',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(vm_id, social_network)
      );
      INSERT INTO profile_new (id, vm_id, instagram_username, instagram_authorized, created_at, updated_at, social_network)
      SELECT id, vm_id, instagram_username, instagram_authorized, created_at, updated_at, COALESCE(social_network, 'instagram') FROM profile;
      DROP TABLE profile;
      ALTER TABLE profile_new RENAME TO profile;
      CREATE INDEX IF NOT EXISTS idx_profile_vm ON profile(vm_id);
      INSERT INTO _migrations (name) VALUES ('profile_multi_per_vm');
    `);
    db.pragma('foreign_keys = ON');
  }

  private migrateVmYoutubeInstalled(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('vm_youtube_installed');
    if (exists) return;
    db.exec(`
      ALTER TABLE vm ADD COLUMN youtube_installed INTEGER DEFAULT 0;
      INSERT INTO _migrations (name) VALUES ('vm_youtube_installed');
    `);
  }

  private migrateVmVkInstalled(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('vm_vk_installed');
    if (exists) return;
    db.exec(`
      ALTER TABLE vm ADD COLUMN vk_installed INTEGER DEFAULT 0;
      INSERT INTO _migrations (name) VALUES ('vm_vk_installed');
    `);
  }

  private migrateScheduledPostUrl(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('scheduled_post_post_url');
    if (exists) return;
    const columns = db.prepare("PRAGMA table_info(scheduled_post)").all() as { name: string }[];
    const hasPostUrl = columns.some((c) => c.name === 'post_url');
    if (!hasPostUrl) {
      db.exec(`
        ALTER TABLE scheduled_post ADD COLUMN post_url TEXT;
      `);
    }
    db.exec("INSERT INTO _migrations (name) VALUES ('scheduled_post_post_url');");
  }

  private migrateScheduledPostSimulatedStatus(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('scheduled_post_simulated_status');
    if (exists) return;
    db.exec(`
      CREATE TABLE scheduled_post_new (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        media_path TEXT NOT NULL,
        title TEXT,
        caption TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','assigned','publishing','published','simulated','failed','cancelled')),
        assigned_at TEXT,
        published_at TEXT,
        post_url TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO scheduled_post_new (
        id, profile_id, media_path, title, caption, scheduled_at, status, assigned_at, published_at, post_url, error_message, created_at, updated_at
      )
      SELECT
        id, profile_id, media_path, NULL, caption, scheduled_at, status, assigned_at, published_at, post_url, error_message, created_at, updated_at
      FROM scheduled_post;
      DROP TABLE scheduled_post;
      ALTER TABLE scheduled_post_new RENAME TO scheduled_post;
      CREATE INDEX IF NOT EXISTS idx_scheduled_status_at ON scheduled_post(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_profile ON scheduled_post(profile_id);
      INSERT INTO _migrations (name) VALUES ('scheduled_post_simulated_status');
    `);
  }

  private migrateScheduledPostTitle(db: Database.Database): void {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get('scheduled_post_title');
    if (exists) return;
    const columns = db.prepare('PRAGMA table_info(scheduled_post)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'title')) {
      db.exec('ALTER TABLE scheduled_post ADD COLUMN title TEXT;');
    }
    db.exec("INSERT INTO _migrations (name) VALUES ('scheduled_post_title');");
  }
}
