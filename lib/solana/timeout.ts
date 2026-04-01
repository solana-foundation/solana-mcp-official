/**
 * Race a promise against a timeout.
 *
 * Use this only for library calls that do NOT accept an AbortSignal.
 * For fetch() or @solana/kit RPC calls, prefer AbortSignal.timeout(ms)
 * instead — it actually cancels the underlying network request.
 *
 * Note: on timeout the underlying promise keeps running until it settles
 * or the OS-level TCP timeout fires. This is acceptable for low-volume
 * MCP tool calls but would need a different approach at higher throughput.
 */
export function raceWithTimeout<T>(promise: Promise<T>, ms: number, label = "Operation"): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  // FIXME(@rogaldh, @pashpashkin): add promise.catch(() => {}) to suppress late unhandled rejections after timeout.
  // Left as-is for easier migration; will be fixed at the end of the inspect_entity port.
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}
