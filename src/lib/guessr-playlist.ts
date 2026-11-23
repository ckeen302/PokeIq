/**
 * PokéGuessr's music order: a shuffle that plays every track once before any
 * repeats, and never plays the same track twice in a row across reshuffles.
 * Pure (the random source is passed in), so it is tested on its own.
 */

export class ShufflePlaylist<T> {
  private queue: T[] = [];
  private last: T | null = null;

  constructor(
    private readonly items: readonly T[],
    private readonly random: () => number = Math.random,
  ) {}

  /** The next track. */
  next(): T {
    if (this.items.length === 0) throw new Error("empty playlist");
    if (this.queue.length === 0) this.queue = this.deal();
    const item = this.queue.shift()!;
    this.last = item;
    return item;
  }

  /** What `next()` will return, without moving on (dealing a new round if needed). */
  peek(): T {
    if (this.items.length === 0) throw new Error("empty playlist");
    if (this.queue.length === 0) this.queue = this.deal();
    return this.queue[0];
  }

  /** A fresh shuffle of every track (Fisher-Yates); its first isn't the one that just played. */
  private deal(): T[] {
    const order = [...this.items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order.length > 1 && order[0] === this.last) {
      const j = 1 + Math.floor(this.random() * (order.length - 1));
      [order[0], order[j]] = [order[j], order[0]];
    }
    return order;
  }
}
