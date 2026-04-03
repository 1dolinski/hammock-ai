import cron, { type ScheduledTask } from 'node-cron';
import { getDb } from './db.js';
import { vlog } from './log.js';

export interface CronJob {
  id: number;
  expression: string;
  prompt: string;
  description: string;
  enabled: number;
  last_run: string | null;
  created_at: string;
}

const activeTasks = new Map<number, ScheduledTask>();

type ChatFn = (message: string) => Promise<void>;
let _chatFn: ChatFn | null = null;

export function setCronChatFn(fn: ChatFn): void {
  _chatFn = fn;
}

export function addCronJob(expression: string, prompt: string, description = ''): CronJob {
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO cron_jobs (expression, prompt, description) VALUES (?, ?, ?)'
  );
  const info = stmt.run(expression, prompt, description);
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(info.lastInsertRowid) as CronJob;
  scheduleJob(job);
  return job;
}

export function listCronJobs(): CronJob[] {
  return getDb().prepare('SELECT * FROM cron_jobs ORDER BY id').all() as CronJob[];
}

export function removeCronJob(id: number): boolean {
  const task = activeTasks.get(id);
  if (task) {
    task.stop();
    activeTasks.delete(id);
  }
  const info = getDb().prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
  return info.changes > 0;
}

export function toggleCronJob(id: number): CronJob | null {
  const db = getDb();
  db.prepare('UPDATE cron_jobs SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJob | undefined;
  if (!job) return null;

  const task = activeTasks.get(id);
  if (job.enabled && !task) {
    scheduleJob(job);
  } else if (!job.enabled && task) {
    task.stop();
    activeTasks.delete(id);
  }
  return job;
}

function scheduleJob(job: CronJob): void {
  if (!job.enabled) return;
  const task = cron.schedule(job.expression, async () => {
    vlog('cron', `tick: job ${job.id} "${job.description || job.prompt}"`);
    getDb().prepare('UPDATE cron_jobs SET last_run = datetime(\'now\') WHERE id = ?').run(job.id);
    if (_chatFn) {
      try {
        await _chatFn(job.prompt);
      } catch (err: any) {
        vlog('cron', `job ${job.id} error: ${err.message}`);
      }
    }
  });
  activeTasks.set(job.id, task);
  vlog('cron', `scheduled job ${job.id}: "${job.expression}" → "${job.prompt}"`);
}

export function startCronJobs(): void {
  const jobs = listCronJobs().filter((j) => j.enabled);
  if (jobs.length === 0) {
    vlog('cron', 'no enabled cron jobs');
    return;
  }
  for (const job of jobs) {
    scheduleJob(job);
  }
  vlog('cron', `started ${jobs.length} cron job(s)`);
}

export function stopAllCronJobs(): void {
  for (const [id, task] of activeTasks) {
    task.stop();
    activeTasks.delete(id);
  }
}
