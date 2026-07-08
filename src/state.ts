// Shared mutable state for the Oski agent runtime.
// All state is in-memory and resets on restart. Persisted fields use JSONL logs.

export interface CompletedTask {
  id: string;
  text: string;
  source: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  reply: string;
  durationMs: number;
}

let lastTask: CompletedTask | null = null;
const recentFailures: CompletedTask[] = [];
let policyViolationCount = 0;
let isProcessing = false;

export function setLastTask(task: CompletedTask): void {
  lastTask = task;
  if (!task.success) {
    recentFailures.unshift(task);
    if (recentFailures.length > 10) recentFailures.pop();
  }
}

export function getLastTask(): CompletedTask | null {
  return lastTask;
}

export function getRecentFailures(): CompletedTask[] {
  return [...recentFailures];
}

export function incrementPolicyViolations(): void {
  policyViolationCount++;
}

export function getPolicyViolationCount(): number {
  return policyViolationCount;
}

export function setProcessing(value: boolean): void {
  isProcessing = value;
}

export function getProcessing(): boolean {
  return isProcessing;
}
