# Async Job Manager or Priority Job Queue

TypeScript priority-based job queue with concurrency control, exponential backoff retries, cancellation, timeouts, and lifecycle events.

## Features

- ⚡ **Concurrency Control** – Limit parallel job execution
- 🎯 **Priority Queue** – Execute high-priority jobs first (`high`, `medium`, `normal`, `low`)
- 🔄 **Automatic Retries** – Exponential backoff with jitter
- ❌ **Cancellation** – Cancel queued or running jobs via `AbortSignal`
- ⏱️ **Timeouts** – Per-job timeout support
- 📡 **Event System** – Observable lifecycle events


## How It Works

1. **Jobs are queued** by priority (high → low)
2. **Concurrency limit** controls parallel execution
3. **Failed jobs retry** with exponential backoff + jitter
4. **Cancellation** propagates via `AbortSignal`
5. **Events emit** at each lifecycle stage

## API

### `new Runner(concurrency, options?)`

**Parameters:**
- `concurrency` (number) – Max parallel jobs
- `options` (object, optional):
  - `maxAtttemps` (number) – Max retry attempts (default: `3`)
  - `baseDelayMs` (number) – Base retry delay (default: `100`)
  - `MaxDelayMs` (number) – Max retry delay (default: `700`)

### `runner.add<T>(fn, priority?, timeoutMs?)`

**Parameters:**
- `fn` – Async function receiving `AbortSignal`
- `priority` – `'high' | 'medium' | 'normal' | 'low'` (default: `'normal'`)
- `timeoutMs` – Job timeout in milliseconds (optional)

**Returns:**
```typescript
{
  promise: Promise<T>,
  cancel: (reason?: string) => void,
  jobId: number
}
```

### `runner.on(event, handler)`

**Events:**
- `queued` – Job added to queue
- `started` – Job execution started
- `succeeded` – Job completed successfully
- `failed` – Job failed after all retries
- `retrying` – Job is retrying after failure
- `cancelled` – Job was cancelled
- `timedOut` – Job exceeded timeout
- `drained` – Queue is empty and all jobs finished

**Returns:** `Unsubscribe` function

## Examples

### Basic Usage

```typescript
const runner = new Runner(2);

const job = runner.add(async (signal) => {
  return await fetchData(signal);
});

const result = await job.promise;
```

### With Priority

```typescript
runner.add(() => slowTask(), 'low');
runner.add(() => urgentTask(), 'high');  // Executes first
```

### With Timeout

```typescript
const { promise } = runner.add(
  async () => await longRunningTask(),
  'normal',
  3000  // 3 second timeout
);

try {
  await promise;
} catch (err) {
  console.error('Timed out or failed');
}
```

### Cancellation

```typescript
const { promise, cancel } = runner.add(async (signal) => {
  signal.addEventListener('abort', () => {
    console.log('Job aborted');
  });
  return await fetch('/api', { signal });
});

// Cancel after 1 second
setTimeout(() => cancel('Taking too long'), 1000);
```

### Event Monitoring

```typescript
runner.on('started', ({ jobId, attempts }) => {
  console.log(`Job ${jobId} started (attempt ${attempts})`);
});

runner.on('retrying', ({ jobId, attempt, delayMs, error }) => {
  console.log(`Job ${jobId} retrying in ${delayMs}ms (attempt ${attempt})`);
});

runner.on('drained', () => {
  console.log('All jobs completed');
});
```
## Priority Weights

```typescript
{ high: 3, medium: 2, normal: 1, low: 0 }
```

## License

MIT

**Clean, scannable, and production-ready.** Covers all key features with practical examples. 🚀