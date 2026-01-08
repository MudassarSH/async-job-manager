// Run almost 200 jobs on this whole logic to test the concurrency
import { describe, it, expect, vi } from "vitest";
import { Runner } from "..";

function flushMicroTasks(times = 5) {
    return (async () => {
        for (let i = 0; i < times; i++) await Promise.resolve();
    })();
}


function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        if (!signal) return

        if (signal.aborted) {
            clearTimeout(t);
            reject(signal.reason ?? new Error("aborted"))
        }

        signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(signal.reason ?? new Error("aborted"))
        }, { once: true }
        )
    })
}


describe("Stress Test of the whole logic", () => {
    it("processes 200 mixed jobs without violating invariants", async () => {

        vi.useFakeTimers();

        vi.spyOn(Math, "random").mockReturnValue(0);

        let concurrency = 8;
        const r = new Runner(concurrency, { maxAtttemps: 3, baseDelayMs: 10, MaxDelayMs: 90 });
        let running = 0;
        let maxRunning = 0;
        let drained = 0;

        r.on("drained", () => drained++)

        let started = new Set<number>();
        let failed = new Set<number>();
        let completed = new Set<number>();
        let cancelled = new Set<number>();
        let timedOut = new Set<number>();

        r.on("started", ({ jobId }: any) => started.add(jobId))
        r.on("failed", ({ jobId }: any) => failed.add(jobId))
        r.on("succeeded", ({ jobId }: any) => completed.add(jobId))
        r.on("cancelled", ({ jobId }: any) => cancelled.add(jobId))
        r.on("timedOut", ({ jobId }: any) => timedOut.add(jobId));

        const attempts: Record<number, number> = {};
        const jobs = Array.from({ length: 200 }, (_, i) => {
            const timesOutMs = (i >= 170 && i <= 184) ? 25 : undefined;

            return r.add(async (signal) => {
                running++;
                maxRunning = Math.max(maxRunning, running);

                try {

                    await sleep(5, signal);

                    if (i >= 120 && i <= 149) {
                        attempts[i] = (attempts[i] ?? 0) + 1;
                        if (attempts[i] < 3) throw new Error("flaky");
                        return i;
                    }
                    if (i >= 150 && i <= 169) {
                        throw new Error("permafail")
                    }

                    if (i >= 171 && i <= 184) {
                        await sleep(10_000, signal);
                        return i;
                    }

                    return i;
                } finally {
                    running--;
                }
            }, "normal", timesOutMs)
        });
        
        const settleAll = Promise.allSettled(jobs.map(h => h.promise));

        for (let i = 185; i < 200; i++) jobs[i].cancel("Cancelled by the user");

        for (let i = 0; i < 50; i++) {
            await vi.runAllTimersAsync();
            await flushMicroTasks();
        }

        await vi.advanceTimersByTimeAsync(1000);
        await flushMicroTasks();


        const result = await settleAll;
        expect(result).toHaveLength(200);

        expect(maxRunning).toBeLessThanOrEqual(concurrency);

        expect(drained).toBe(1);

        for (let i = 120; i <= 140; i++)expect(completed.has(i)).toBe(true);
        for (let i = 150; i <= 169; i++)expect(failed.has(i)).toBe(true);
        for (let i = 171; i <= 184; i++)expect(timedOut.has(i)).toBe(true);
        for (let i = 185; i < 200; i++)expect(cancelled.has(i)).toBe(true);

        expect(started.size).toBeLessThanOrEqual(200);

        (Math.random as any).mockRestore?.();
        vi.useRealTimers();
    }, 20_000);
})