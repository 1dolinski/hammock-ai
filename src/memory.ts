import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface Task {
  id: string;
  title: string;
  createdAt: string;
}

export interface Memory {
  content: string;
  timestamp: string;
}

export interface ConversationTurn {
  role: string;
  content: string;
}

export interface KnownTool {
  namespace: string;
  endpoint: string;
  description: string;
  keywords: string[];
  lastBody: Record<string, any>;
  useCount: number;
}

export interface AppState {
  tasks: {
    todo: Task[];
    upcoming: Task[];
    done: Task[];
  };
  memories: Memory[];
  history: ConversationTurn[];
  knownTools: KnownTool[];
}

export const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'memory.json');
const CONVERSATIONS_DIR = join(DATA_DIR, 'conversations');
const MEMORIES_DIR = join(DATA_DIR, 'memories');
const TASKS_FILE = join(DATA_DIR, 'tasks.md');

function ensureDirs(): void {
  for (const d of [DATA_DIR, CONVERSATIONS_DIR, MEMORIES_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function todayFile(): string {
  return join(CONVERSATIONS_DIR, `${new Date().toISOString().slice(0, 10)}.md`);
}

function writeConversationTurn(role: string, content: string): void {
  ensureDirs();
  const file = todayFile();
  const time = new Date().toLocaleTimeString();
  if (!existsSync(file)) {
    writeFileSync(file, `# Conversation — ${new Date().toISOString().slice(0, 10)}\n\n`);
  }
  appendFileSync(file, `### ${role} (${time})\n\n${content}\n\n---\n\n`);
}

function writeMemoryFile(content: string, timestamp: string): void {
  ensureDirs();
  const slug = timestamp.replace(/[:.]/g, '-');
  writeFileSync(join(MEMORIES_DIR, `${slug}.md`), `# Memory\n\n${content}\n\n_Saved: ${timestamp}_\n`);
}

function writeTasksFile(state: AppState): void {
  ensureDirs();
  const fmt = (list: Task[]) =>
    list.length ? list.map((t) => `- ${t.title}`).join('\n') : '_(empty)_';
  const md = `# Tasks\n\n## TODO\n${fmt(state.tasks.todo)}\n\n## Upcoming\n${fmt(state.tasks.upcoming)}\n\n## Done\n${fmt(state.tasks.done)}\n`;
  writeFileSync(TASKS_FILE, md);
}

function defaults(): AppState {
  return {
    tasks: { todo: [], upcoming: [], done: [] },
    memories: [],
    history: [],
    knownTools: [],
  };
}

export function loadState(): AppState {
  try {
    if (!existsSync(STATE_FILE)) return defaults();
    const loaded = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    return { ...defaults(), ...loaded };
  } catch {
    return defaults();
  }
}

export function saveState(state: AppState): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let idCounter = Date.now();

export function addTask(
  state: AppState,
  title: string,
  list: 'todo' | 'upcoming' | 'done' = 'todo'
): Task {
  const task: Task = {
    id: String(++idCounter),
    title,
    createdAt: new Date().toISOString(),
  };
  state.tasks[list].push(task);
  saveState(state);
  writeTasksFile(state);
  return task;
}

export function moveTask(
  state: AppState,
  taskId: string,
  to: 'todo' | 'upcoming' | 'done'
): string {
  for (const list of ['todo', 'upcoming', 'done'] as const) {
    const idx = state.tasks[list].findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      const [task] = state.tasks[list].splice(idx, 1);
      state.tasks[to].push(task);
      saveState(state);
      writeTasksFile(state);
      return `Moved "${task.title}" to ${to}`;
    }
  }
  return `Task ${taskId} not found`;
}

export function removeTask(state: AppState, taskId: string): string {
  for (const list of ['todo', 'upcoming', 'done'] as const) {
    const idx = state.tasks[list].findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      const [task] = state.tasks[list].splice(idx, 1);
      saveState(state);
      writeTasksFile(state);
      return `Removed "${task.title}" from ${list}`;
    }
  }
  return `Task ${taskId} not found`;
}

export function addMemory(state: AppState, content: string): void {
  const timestamp = new Date().toISOString();
  state.memories.push({ content, timestamp });
  if (state.memories.length > 100) state.memories = state.memories.slice(-100);
  saveState(state);
  writeMemoryFile(content, timestamp);
}

export function pushHistory(state: AppState, role: string, content: string): void {
  state.history.push({ role, content });
  if (state.history.length > 40) state.history = state.history.slice(-40);
  saveState(state);
  writeConversationTurn(role, content);
}

export function registerTool(
  state: AppState,
  namespace: string,
  endpoint: string,
  description: string,
  keywords: string[],
  body: Record<string, any>
): void {
  const existing = state.knownTools.find(
    (t) => t.namespace === namespace && t.endpoint === endpoint
  );
  if (existing) {
    existing.useCount++;
    existing.lastBody = body;
    existing.keywords = [...new Set([...existing.keywords, ...keywords])];
  } else {
    state.knownTools.push({
      namespace,
      endpoint,
      description,
      keywords,
      lastBody: body,
      useCount: 1,
    });
  }
  saveState(state);
}

export function findMatchingTool(
  state: AppState,
  message: string
): KnownTool | null {
  const words = message.toLowerCase().split(/\s+/);
  let best: KnownTool | null = null;
  let bestScore = 0;

  for (const tool of state.knownTools) {
    let score = 0;
    for (const kw of tool.keywords) {
      const kwLower = kw.toLowerCase();
      if (words.some((w) => w.includes(kwLower) || kwLower.includes(w))) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = tool;
    }
  }

  return bestScore >= 1 ? best : null;
}

export function formatTasks(state: AppState): string {
  const fmt = (list: Task[]) =>
    list.length
      ? list.map((t) => `  - [${t.id}] ${t.title}`).join('\n')
      : '  (empty)';
  return [
    'TODO:',
    fmt(state.tasks.todo),
    '',
    'UPCOMING:',
    fmt(state.tasks.upcoming),
    '',
    'DONE:',
    fmt(state.tasks.done),
  ].join('\n');
}

export function formatMemories(state: AppState): string {
  if (!state.memories.length) return '(no saved memories yet)';
  return state.memories.map((m) => `- ${m.content}`).join('\n');
}
