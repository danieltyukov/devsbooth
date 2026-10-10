/**
 * Ends rooms that stay empty for `ttlMs`. A room counts as empty from creation
 * until someone joins, and again whenever the last person leaves.
 */
export class RoomLifecycle {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly ttlMs: number,
    private readonly onExpire: (roomId: string) => void,
  ) {}

  vacant(roomId: string): void {
    if (this.ttlMs <= 0) return;
    this.occupied(roomId);
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      this.onExpire(roomId);
    }, this.ttlMs);
    timer.unref();
    this.timers.set(roomId, timer);
  }

  occupied(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
  }

  isScheduled(roomId: string): boolean {
    return this.timers.has(roomId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
