import { expect, describe, it, vi } from "vitest";
import { Runner } from "..";
import { flushMicroTasks, trackEven } from "./helpers";

const sleep = (ms: number) => new Promise<void>(re => setTimeout(re, ms));

describe("running concurrency", () => {
    it("it never exceeds the concurrency limits", async () => {
        const runner = new Runner(3);
        let running = 0;
        let max = 0;
        const jobs = Array.from({ length: 30 }, (_, i) => {
            runner.add(async () => {
                running++;
                max = Math.max(max, running);
                await sleep(30);
                running--;
                return i;
            })
        });

        const result = await Promise.all(jobs);
        console.log("Result", result);
        console.log("max", max);
        expect(result).toHaveLength(30);
        expect(max).toBeLessThanOrEqual(3);
    });
    it("propogates failure without breaking the queue", async () => {
        const runner = new Runner(1);
        const ok = runner.add(async () => "ok");
        const bad = runner.add(async () => { throw new Error("Boom") })
        const ok2 = runner.add(async () => "ok2");
        const bad2 = runner.add(async () => { throw new Error("Boom2") });
        await Promise.allSettled([ok.promise, bad.promise, ok2.promise, bad2.promise])
        // bad2.promise.catch(() => {}) // Added because of getting error without reason
        console.log(ok)
        expect(ok.promise).resolves.toBe("ok")
        expect(bad.promise).rejects.toThrow("Boom")
        expect(ok2.promise).resolves.toBe("ok2")
        expect(bad2.promise).rejects.toThrow("Boom2")
    });

    it("queue drains completely", async () => {
        const runner = new Runner(2);
        let drained = 0;
        let countAtDrain: number = 0;
        const totalJobs = 10;
        let completedCount = 0;

        runner.on("drained", () => {
            drained += 1;
            console.log(drained);
            countAtDrain = completedCount

        })
        const promiseJobs = Array.from({ length: 10 }, (_, i) => {
            return runner.add(async () => {
                await sleep(5);
                completedCount++;
                return { id: i + 1, job: `Job ${i}` }
            }).promise
        })
        const result = await Promise.all(promiseJobs);
        expect(result).toHaveLength(totalJobs);
        expect(completedCount).toBe(totalJobs);

        await Promise.resolve();

        expect(drained).toBe(1);
        expect(countAtDrain).toBe(totalJobs)
    });

    it("Event sequence per job: queued → started → completed", async () => {
        const runner = new Runner(2);
        const totalJobs = 10;
        let logByJobId = new Map<number, string[]>();
        const record = (jobId: number, eventName: string) => {
            const arr = logByJobId.get(jobId) ?? [];
            arr.push(eventName);
            logByJobId.set(jobId, arr);
        }
        runner.on("queued", ({ jobId }) => record(jobId, "queued"));
        runner.on("started", ({ jobId }) => record(jobId, "started"));
        runner.on("succeeded", ({ jobId }) => record(jobId, "succeeded"));
        runner.on("failed", ({ jobId }) => record(jobId, "failed"));

        const promiseJobs = Array.from({ length: 10 }, (_, i) => {
            return runner.add(async () => {
                await sleep(5);
                return `job-${i}`
            }).promise
        });
        await Promise.all(promiseJobs);
        for (let jobId = 0; jobId < totalJobs; jobId++) {
            const events = logByJobId.get(jobId) ?? [];

            expect(events[0]).toBe("queued");

            const queueIdx = events.indexOf("queued");
            // console.log("QueueIdx: ", queueIdx);
            const startIdx = events.indexOf("started");
            // console.log("StartIdx: ", startIdx);
            const successIdx = events.indexOf("succeeded");
            // console.log("SuccessIdx: ", successIdx);
            const failedIdx = events.indexOf("failed");
            // console.log("FailedIdx: ", failedIdx);

            expect(queueIdx).toBeLessThan(startIdx);
            expect(startIdx).toBeLessThan(successIdx);
            expect(failedIdx).toBe(-1);
        }
    })
    it("Failures reject promises and emit failed", async () => {
        const runner = new Runner(2);

        const subById = new Map<number, string[]>();
        const record = (jobId: number, event: string) => {
            const arr = subById.get(jobId) ?? [];
            arr.push(event);
            subById.set(jobId, arr);
        }

        runner.on("started", ({ jobId }) => record(jobId, "started"))
        runner.on("succeeded", ({ jobId }) => record(jobId, "succeeded"));
        runner.on("failed", ({ jobId }) => record(jobId, "failed"));

        const ok = runner.add(async () => "ok");
        const bad = runner.add(async () => { throw new Error("Boom") });
        const allDone = await Promise.allSettled([ok.promise, bad.promise]);

        expect(allDone[0].status).toBe("fulfilled");
        expect(allDone[1].status).toBe("rejected");
        const failedTest = subById.get(1);

        expect(failedTest).toContain("failed");
        expect(failedTest).not.toContain("succeeded")
    })

    it("Basic showing of queue, starts and completed", async () => {
        const r = new Runner(2);
        const ev = trackEven(r, ["queued", "started", "failed", "succeeded", "timedOut", "drained"] as any);

        const a = r.add(async () => 1);
        const b = r.add(async () => 2);

        await expect(a.promise).resolves.toBe(1);
        await expect(b.promise).resolves.toBe(2);

        await flushMicroTasks();

        expect(ev.count("queued")).toBe(2);
        expect(ev.count("started")).toBe(2);
        expect(ev.count("succeeded")).toBe(2);
        expect(ev.count("drained")).toBe(1);
        expect(ev.last("drained")?.payload).toEqual({ remaining: 0 });
    });


    it("Priority affects execution order (when concurrency = 1)", async () => {
        const r = new Runner(1);
        const order: number[] = [];
        const j1 = r.add(async () => { order.push(223); return }, "normal")
        const j7 = r.add(async () => { order.push(22); return }, "low")
        const j2 = r.add(async () => { order.push(20); return }, "high")
        const j3 = r.add(async () => { order.push(11); return }, "medium")
        const j4 = r.add(async () => { order.push(100); return }, "high")
        const j5 = r.add(async () => { order.push(30); return }, "medium")
        const j6 = r.add(async () => { order.push(90); return }, "medium");
        await Promise.allSettled([j1.promise, j2.promise, j3.promise, j4.promise, j5.promise, j6.promise, j7.promise]);
        console.log("Order is: ", order)
        expect(order).toEqual([20, 100, 223, 11, 30, 90, 22])
    })
    it("Retries happen up to maxAttempts, with correct event emission", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const r = new Runner(1, { maxAtttemps: 3, baseDelayMs: 10, MaxDelayMs: 400 });
        const ev = trackEven(r, ["failed", "retrying", "timedOut", "drained", "started"] as any);
        let count = 0;
        const a = r.add(
            async () => {
                count++;
                throw new Error("Hell!")
            });

            const aAssert = expect(a.promise).rejects.toBeTruthy();
        await vi.runAllTimersAsync();
        // await flushMicroTasks()
        // await Promise.allSettled([a.promise])
        console.log("Count is: ", count)

        await aAssert
        expect(count).toBe(3);
        vi.useRealTimers();
        vi.restoreAllMocks()
    })

    it("timeout aborts and reject ones", async () => {
        vi.useFakeTimers();

        vi.spyOn(Math, "random").mockReturnValue(0);
        const r = new Runner(1);
        const ev = trackEven(r, ["failed", "retrying", "timedOut"] as any);
        let data = false;
        const a = r.add(async () => {
            await new Promise(() => { })
        }, "normal", 50);

        const b = r.add(async () => {
            data = true;
            return 123;
        }, "normal", 50);

        const aAssert = expect(a.promise).rejects.toBeTruthy()
        const bAssert = expect(b.promise).resolves.toBe(123)
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(70);

        await aAssert;
        expect(ev.count("timedOut")).toBeGreaterThan(0)

        // console.log(a)
        // console.log(b)

        await vi.runAllTimersAsync();
        await bAssert;
        expect(data).toBe(true);
        vi.useRealTimers();
    });
    it("Running cancellation aborts and rejects once", async () => {
        const r = new Runner(1);
        const ev = trackEven(r, ["failed", "retrying", "cancelled"] as any);

        const a = r.add(async () => {
            const add = 219 + 2190;
            return add;
        }, "medium");
        const b = r.add(async () => {
            const add = 21 + 29;
            return add;
        }, "medium");

        a.cancel("Cancel this job ASAP");
        flushMicroTasks();
        await expect(a.promise).rejects.toBe("Cancel this job ASAP");
        expect(ev.count("cancelled")).toBe(1);
        await expect(b.promise).resolves.toBe(50);
    })

})