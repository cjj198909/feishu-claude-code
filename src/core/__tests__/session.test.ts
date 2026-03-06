import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session.js';
import { Database } from '../../db/database.js';

describe('SessionManager', () => {
  let db: Database;
  let sm: SessionManager;

  beforeEach(() => {
    db = new Database(':memory:');
    sm = new SessionManager(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should add and switch projects', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    expect(sm.getActiveProject()?.name).toBe('myapp');
  });

  it('should return null if no active project', () => {
    expect(sm.getActiveProject()).toBeNull();
  });

  it('should switch between projects', () => {
    sm.addProject('a', '/path/a');
    sm.addProject('b', '/path/b');
    sm.switchProject('a');
    expect(sm.getActiveProject()?.name).toBe('a');
    sm.switchProject('b');
    expect(sm.getActiveProject()?.name).toBe('b');
  });

  it('should throw when switching to non-existent project', () => {
    expect(() => sm.switchProject('nope')).toThrow();
  });

  it('should reject paths with ..', () => {
    expect(() => sm.addProject('bad', '/home/../etc/passwd')).toThrow();
  });

  it('should save and restore session', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-abc', 'did things');
    const session = sm.getCurrentSessionId();
    expect(session).toBe('sess-abc');
  });

  it('should reset session', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-abc', 'did things');
    sm.resetCurrentSession();
    expect(sm.getCurrentSessionId()).toBeNull();
  });

  it('should list session history', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-1', 'first');
    sm.saveCurrentSession('sess-2', 'second');
    const history = sm.getSessionHistory();
    expect(history).toHaveLength(2);
  });

  it('should resume session by db id', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-1', 'first');
    sm.saveCurrentSession('sess-2', 'second');
    const history = sm.getSessionHistory();
    const oldId = history.find(s => s.session_id === 'sess-1')!.id;
    sm.resumeSession(oldId);
    expect(sm.getCurrentSessionId()).toBe('sess-1');
  });
});
