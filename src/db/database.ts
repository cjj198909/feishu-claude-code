import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export interface Project {
  id: number;
  name: string;
  path: string;
  description: string | null;
  permission_mode: string;
  allowed_tools: string;
  max_turns: number;
  created_at: string;
}

export interface Session {
  id: number;
  project_name: string;
  session_id: string;
  summary: string | null;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

export interface UsageStats {
  total: { cost: number; calls: number; turns: number };
  today: { cost: number; calls: number; turns: number };
  week: { cost: number; calls: number; turns: number };
  month: { cost: number; calls: number; turns: number };
  byProject: Record<string, { cost: number; calls: number }>;
}

export class Database {
  db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        description TEXT,
        permission_mode TEXT DEFAULT 'bypassPermissions',
        allowed_tools TEXT DEFAULT 'Read,Write,Edit,Bash,Glob,Grep',
        max_turns INTEGER DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        summary TEXT,
        is_active BOOLEAN DEFAULT 0,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        session_id TEXT,
        cost_usd REAL DEFAULT 0,
        duration_ms INTEGER,
        num_turns INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // --- Projects ---

  addProject(name: string, path: string, options?: { description?: string; permission_mode?: string; allowed_tools?: string; max_turns?: number }) {
    this.db.prepare(
      'INSERT INTO projects (name, path, description, permission_mode, allowed_tools, max_turns) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      name, path,
      options?.description ?? null,
      options?.permission_mode ?? 'bypassPermissions',
      options?.allowed_tools ?? 'Read,Write,Edit,Bash,Glob,Grep',
      options?.max_turns ?? 100
    );
  }

  removeProject(name: string) {
    this.db.prepare('DELETE FROM projects WHERE name = ?').run(name);
    this.db.prepare('DELETE FROM sessions WHERE project_name = ?').run(name);
  }

  getProject(name: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as Project | undefined;
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all() as Project[];
  }

  updateProjectConfig(name: string, key: string, value: string) {
    const allowed = ['permission_mode', 'allowed_tools', 'max_turns', 'description'];
    if (!allowed.includes(key)) throw new Error(`Invalid config key: ${key}`);
    this.db.prepare(`UPDATE projects SET ${key} = ? WHERE name = ?`).run(value, name);
  }

  // --- Sessions ---

  saveSession(projectName: string, sessionId: string, summary: string | null) {
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE project_name = ?').run(projectName);
    this.db.prepare(
      'INSERT INTO sessions (project_name, session_id, summary, is_active, last_used_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)'
    ).run(projectName, sessionId, summary);
  }

  setActiveSession(projectName: string, sessionDbId: number) {
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE project_name = ?').run(projectName);
    this.db.prepare('UPDATE sessions SET is_active = 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionDbId);
  }

  getActiveSession(projectName: string): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE project_name = ? AND is_active = 1').get(projectName) as Session | undefined;
  }

  listSessions(projectName: string): Session[] {
    return this.db.prepare('SELECT * FROM sessions WHERE project_name = ? ORDER BY created_at DESC').all(projectName) as Session[];
  }

  resetSession(projectName: string) {
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE project_name = ?').run(projectName);
  }

  getSessionById(id: number): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  // --- Usage Stats ---

  recordUsage(projectName: string, sessionId: string | null, costUsd: number, durationMs: number, numTurns: number) {
    this.db.prepare(
      'INSERT INTO usage_stats (project_name, session_id, cost_usd, duration_ms, num_turns) VALUES (?, ?, ?, ?, ?)'
    ).run(projectName, sessionId, costUsd, durationMs, numTurns);
  }

  getUsageStats(): UsageStats {
    const total = this.db.prepare(
      'SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats'
    ).get() as { cost: number; calls: number; turns: number };

    const today = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats WHERE date(created_at) = date('now')"
    ).get() as { cost: number; calls: number; turns: number };

    const week = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats WHERE created_at >= datetime('now', '-7 days')"
    ).get() as { cost: number; calls: number; turns: number };

    const month = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats WHERE created_at >= datetime('now', '-30 days')"
    ).get() as { cost: number; calls: number; turns: number };

    const byProjectRows = this.db.prepare(
      'SELECT project_name, COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls FROM usage_stats GROUP BY project_name'
    ).all() as { project_name: string; cost: number; calls: number }[];

    const byProject: Record<string, { cost: number; calls: number }> = {};
    for (const row of byProjectRows) {
      byProject[row.project_name] = { cost: row.cost, calls: row.calls };
    }

    return { total, today, week, month, byProject };
  }

  close() {
    this.db.close();
  }
}
