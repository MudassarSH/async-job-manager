
import { EventTypes, Job, Priority, QueueJob, Unsubscribe, WEIGHTS } from "./Interface";

export class Runner {
    private queue: QueueJob<unknown>[] = [];
    private inFlight = 0;
    private id = 0;
    private readonly maxAtttemps: number;
    private readonly baseDelayMs: number;
    private readonly MaxDelayMs: number;
    private listeners: {
        [K in keyof EventTypes]: Array<(payload: EventTypes[K]) => void>
    } = {} as any;


    constructor(private readonly concurrency: number, opts?: { maxAtttemps?: number, baseDelayMs?: number, MaxDelayMs?: number }) {
        if (!Number.isInteger(concurrency) || concurrency <= 0) {
            throw new Error("Concurrency must be greater than zero")
        }

        this.maxAtttemps = opts?.maxAtttemps ?? 3;
        this.baseDelayMs = opts?.baseDelayMs ?? 100;
        this.MaxDelayMs = opts?.MaxDelayMs ?? 700;
        if (!Number.isInteger(this.maxAtttemps) || this.maxAtttemps <= 0) {
            throw new Error("Attempts must be greater than zero")
        }
        if (this.maxAtttemps < 0 || this.baseDelayMs < 0 || this.MaxDelayMs < 0 || this.MaxDelayMs < this.baseDelayMs) {
            throw new Error("Invalid backoff delay")
        }

    }

    add<T>(fn: Job<T>, priority?: Priority, timeoutMs?: number) {
        const jobId = this.id++;
        const p: Priority = priority ?? "normal";

        let jobRef: QueueJob<T>;
        const promise = new Promise<T>((resolve, reject) => {
            jobRef = {
                jobId,
                fn,
                resolve,
                reject,
                status: "queued",
                priority: p,
                attempt: 1,
                controller: undefined,
                timeoutMs,
                timeoutHandler: undefined,
                stopReason: undefined
            };
            this.insertByPriority(jobRef as QueueJob<unknown>);
            this.emit("queued", { jobId });
            jobRef.status = "queued"
            setTimeout(() => this.pump(), 0);
        });

        const cancel = (reason?: string) => {
            const j = jobRef!;

            if (j.stopReason) return;

            if (j.status === "completed" || j.status === "cancelled" || j.status === "timedOut") return;

            if (j.status === "queued") {
                const idx = this.queue.findIndex(q => q.jobId === j.jobId);
                if (idx >= 0) this.queue.splice(idx, 1);

                j.status = "cancelled";
                j.stopReason = "cancelled";

                this.emit("cancelled", { jobId: j.jobId, error: reason });

                j.reject(reason ?? new Error("Cancelled by the user"));
                return;
            }

            if (j.status === "running") {
                j.status = 'cancelled';
                j.stopReason = "cancelled"
                j.controller?.abort(reason ?? new Error("Cancelled by the user"))
            }
        }

        return { promise, cancel, jobId }
    }

    private insertByPriority(job: QueueJob<unknown>) {
        const w = WEIGHTS[job.priority];
        let i = 0;
        while (i < this.queue.length) {
            const cur = this.queue[i];
            const curw = WEIGHTS[cur.priority];
            if (curw < w) break;
            i++
        };

        this.queue.splice(i, 0, job)
    }

    private computeDelayMs(attempt: number): number {
        const exp = this.baseDelayMs * Math.pow(2, attempt - 1);
        const backoff = Math.min(this.MaxDelayMs, exp);

        return Math.floor(Math.random() * (backoff + 1))
    }

    private pump(): void {
        while (this.inFlight < this.concurrency && this.queue.length > 0) {
            const job = this.queue.shift()!;
            this.inFlight++;
            job.status = "running";
            job.controller = new AbortController();
            const signal = job.controller.signal;
            let finish = false;

            const clearTimeoutIfAny = () => {
                if (job.timeoutHandler) {
                    clearTimeout(job.timeoutHandler);
                    job.timeoutHandler = undefined;
                }
            }
            const timeoutPromise = job.timeoutMs == null ? null : new Promise<never>((_, reject) => {
                job.timeoutHandler = setTimeout(() => {
                    if (finish) return;
                    finish = true;
                    if (job.status != "running") return;
                    job.status = "timedOut";
                    job.stopReason = "timedOut";
                    const err = new Error("Timed Out")
                    job.controller?.abort(err);
                    this.emit("timedOut", { jobId: job.jobId, timedOutMs: job.timeoutMs });
                    reject(err)
                }, job.timeoutMs)

            })

            this.emit("started", { jobId: job.jobId, attempts: job.attempt });
            const fnPromise = Promise.resolve().then(() => job.fn(signal))

            Promise.resolve()
                .then(() => (timeoutPromise ? Promise.race([fnPromise, timeoutPromise]) : fnPromise))
                .then((value) => {
                    if (finish) return;
                    finish = true;
                    if (job.status !== "running") return;
                    this.emit("succeeded", { jobId: job.jobId, val: value });
                    job.status = "completed"
                    job?.resolve(value);
                })
                .catch((error) => {
                    clearTimeoutIfAny();
                    if (job.stopReason === "cancelled") {
                        job.status = "cancelled";
                        this.emit("cancelled", { jobId: job.jobId, error: error });
                        job.reject(error);
                        return
                    }
                    if (job.stopReason === "timedOut") {
                        // job.status = "timedOut";
                        // this.emit("timedOut", { jobId: job.jobId, timedOutMs: job.timeoutMs });
                        job.reject(error);
                        return;
                    }
                    if (this.maxAtttemps > job.attempt) {
                        const delay = this.computeDelayMs(job.attempt);
                        const Nattempt = job.attempt + 1;
                        this.emit("retrying", { jobId: job.jobId, attempt: Nattempt, delayMs: delay, error: error });
                        job.status = "retrying"
                        job.attempt = Nattempt;
                        if (job.timeoutHandler) {
                            clearTimeout(job.timeoutHandler);
                            job.timeoutHandler = undefined;
                        }

                        setTimeout(() => {
                            if (job.stopReason) return;
                            job.status = "queued";
                            job.stopReason = undefined;
                            job.controller = undefined;
                            this.insertByPriority(job as QueueJob<unknown>);
                            this.emit("queued", { jobId: job.jobId });
                            this.pump()
                        }, delay)
                        return;
                    } else {
                        this.emit("failed", { jobId: job.jobId, error: error });
                        job.status = "failed";
                        job?.reject(error)
                    }
                })
                .finally(() => {
                    clearTimeoutIfAny();
                    job.timeoutHandler = undefined;
                    this.inFlight--;
                    if (this.inFlight === 0 && this.queue.length === 0) {
                        this.emit("drained", { remaining: 0 });
                    } else {
                        this.pump()
                    }
                })
        }
    }

    on<K extends keyof EventTypes>(event: K, handlers: (payload: EventTypes[K]) => void): Unsubscribe {
        const arr = (this.listeners[event] ??= []);
        (arr).push(handlers);
        return () => {
            const idx = arr.indexOf(handlers as any);
            if (idx >= 0) arr.splice(idx, 1)
        }
    }

    private emit<K extends keyof EventTypes>(event: K, payload: EventTypes[K]) {
        this.listeners[event]?.forEach(k => k(payload));
    }
}