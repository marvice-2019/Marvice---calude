// Lets the data layer wake the job runner right after it queues email, so confirmations don't wait for the next poll.
// The runner registers itself here when it starts; with no runner (memory mode, tests, scripts) a kick does nothing.

type Kick = () => void;
const shared = globalThis as typeof globalThis & { __hourhandKick?: Kick | null };

export function setJobKick(kick: Kick | null): void {
  shared.__hourhandKick = kick;
}

export function kickJobs(): void {
  shared.__hourhandKick?.();
}
