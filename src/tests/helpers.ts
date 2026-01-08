import { vi } from "vitest";

export function deffered<T>() {
    let resolve!: (val: T) => void;
    let reject!: (err: string) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res, rej = reject });
    return { promise, resolve, reject }
}

export async function flushMicroTasks() {
    await Promise.resolve();
    await Promise.resolve();
}

export function trackEven<T extends Record<string, string>>(runner: any, names: (keyof T)[]) {
    const events: Array<{ type: string, payload: any }> = [];
    const unsub = names.map((name) => runner.on(name as any, (payload: any) => events.push({ type: String(name), payload }))
    )

    return {
        events,
        stop: () => unsub.forEach((u) => u()),
        count: (type: string) => events.filter(t => t.type == type).length,
        last: (type: string) => [...events].reverse().find(e => e.type === type)
    }
}