// Coordination within this single server. These locks are not distributed leases.
const queues = new Map<string, Promise<void>>();
export async function withLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(name) || Promise.resolve();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => waiting);
  queues.set(name, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(name) === tail) queues.delete(name);
  }
}
