export type Job<T> = (signal: AbortSignal) => Promise<T> | T;
export type Unsubscribe = () => void;
export const WEIGHTS = { high: 3, medium: 2, normal: 1, low: 0 } as const;
export type Priority = keyof typeof WEIGHTS;


export type QueueJob<T> = {
    jobId: number;
    fn: Job<T>;
    resolve: (val: T) => void;
    reject: (err?: unknown) => void;
    priority: Priority;
    status: "queued" | "completed" | "failed" | "running" | "cancelled" | "timedOut" | "retrying"
    attempt: number;
    controller?: AbortController;
    timeoutMs?: number;
    stopReason?: string | undefined;
    timeoutHandler?: ReturnType<typeof setTimeout>;
}

export type QueueLevels = {
    high: 3,
    medium: 2,
    normal: 1,
}

export type EventTypes<T = unknown> = {
    queued: { jobId: number };
    started: { jobId: number, attempts: number };
    failed: { jobId: number, error: string };
    succeeded: { jobId: number, val: T };
    cancelled: { jobId: number, error?: string };
    timedOut: { jobId: number, timedOutMs?: number };
    retrying: { jobId: number, attempt: number, delayMs: number, error?: string };
    drained: { remaining: 0 }
}
