import { statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Database, type Project, type Session } from '../db/database.js';

export class SessionManager {
  private db: Database;
  private activeProjectName: string | null = null;

  constructor(db: Database) {
    this.db = db;
  }

  addProject(name: string, path: string, options?: { description?: string; permission_mode?: string; allowed_tools?: string; max_turns?: number }) {
    if (path.includes('..')) {
      throw new Error('Path must not contain ".."');
    }
    this.db.addProject(name, path, options);
  }

  removeProject(name: string) {
    this.db.removeProject(name);
    if (this.activeProjectName === name) {
      this.activeProjectName = null;
    }
  }

  listProjects(): Project[] {
    return this.db.listProjects();
  }

  switchProject(name: string) {
    const project = this.db.getProject(name);
    if (!project) throw new Error(`Project "${name}" not found`);
    this.activeProjectName = name;
  }

  getActiveProject(): Project | null {
    if (!this.activeProjectName) return null;
    return this.db.getProject(this.activeProjectName) ?? null;
  }

  updateProjectConfig(key: string, value: string) {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.updateProjectConfig(this.activeProjectName, key, value);
  }

  getCurrentSessionId(): string | null {
    if (!this.activeProjectName) return null;
    const session = this.db.getActiveSession(this.activeProjectName);
    return session?.session_id ?? null;
  }

  saveCurrentSession(sessionId: string, summary: string | null) {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.saveSession(this.activeProjectName, sessionId, summary);
  }

  resetCurrentSession() {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.resetSession(this.activeProjectName);
  }

  getSessionHistory(): Session[] {
    if (!this.activeProjectName) return [];
    return this.db.listSessions(this.activeProjectName);
  }

  resumeSession(dbId: number) {
    const session = this.db.getSessionById(dbId);
    if (!session) throw new Error(`Session #${dbId} not found`);
    if (session.project_name !== this.activeProjectName) {
      throw new Error(`Session #${dbId} belongs to project "${session.project_name}", not "${this.activeProjectName}"`);
    }
    this.db.setActiveSession(this.activeProjectName!, dbId);
  }

  recordUsage(sessionId: string | null, costUsd: number, durationMs: number, numTurns: number) {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.recordUsage(this.activeProjectName, sessionId, costUsd, durationMs, numTurns);
  }

  getUsageStats() {
    return this.db.getUsageStats();
  }

  /** Get the active session's JSONL file size in bytes, or null if unavailable. */
  getSessionFileSize(): number | null {
    const sessionId = this.getCurrentSessionId();
    const project = this.getActiveProject();
    if (!sessionId || !project) return null;
    // Claude stores sessions at ~/.claude/projects/{hash}/{sessionId}.jsonl
    // where hash = absolute path with '/' replaced by '-'
    const hash = project.path.replace(/\//g, '-');
    const filePath = join(homedir(), '.claude', 'projects', hash, `${sessionId}.jsonl`);
    try { return statSync(filePath).size; } catch { return null; }
  }
}
