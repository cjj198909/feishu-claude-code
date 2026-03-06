import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../database.js';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should create all tables on init', () => {
    const tables = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('projects');
    expect(names).toContain('sessions');
    expect(names).toContain('usage_stats');
  });

  // --- projects ---
  it('should add and list projects', () => {
    db.addProject('myapp', '/home/user/myapp');
    const projects = db.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('myapp');
    expect(projects[0].path).toBe('/home/user/myapp');
  });

  it('should reject duplicate project names', () => {
    db.addProject('myapp', '/path/a');
    expect(() => db.addProject('myapp', '/path/b')).toThrow();
  });

  it('should remove a project', () => {
    db.addProject('myapp', '/path/a');
    db.removeProject('myapp');
    expect(db.listProjects()).toHaveLength(0);
  });

  it('should get project by name', () => {
    db.addProject('myapp', '/path/a', { description: 'test' });
    const p = db.getProject('myapp');
    expect(p?.description).toBe('test');
  });

  it('should update project config', () => {
    db.addProject('myapp', '/path/a');
    db.updateProjectConfig('myapp', 'permission_mode', 'acceptEdits');
    const p = db.getProject('myapp');
    expect(p?.permission_mode).toBe('acceptEdits');
  });

  // --- sessions ---
  it('should save and get active session', () => {
    db.addProject('myapp', '/path/a');
    db.saveSession('myapp', 'sess-123', 'did stuff');
    db.setActiveSession('myapp', 1);
    const s = db.getActiveSession('myapp');
    expect(s?.session_id).toBe('sess-123');
  });

  it('should list session history', () => {
    db.addProject('myapp', '/path/a');
    db.saveSession('myapp', 'sess-1', 'first');
    db.saveSession('myapp', 'sess-2', 'second');
    const history = db.listSessions('myapp');
    expect(history).toHaveLength(2);
  });

  // --- usage_stats ---
  it('should record and query usage', () => {
    db.addProject('myapp', '/path/a');
    db.recordUsage('myapp', 'sess-1', 0.05, 1500, 10);
    db.recordUsage('myapp', 'sess-2', 0.03, 800, 5);
    const stats = db.getUsageStats();
    expect(stats.total.cost).toBeCloseTo(0.08);
    expect(stats.total.calls).toBe(2);
    expect(stats.byProject['myapp'].cost).toBeCloseTo(0.08);
  });
});
