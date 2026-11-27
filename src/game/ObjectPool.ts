import type { PoolItem } from './types';

/**
 * 固定结构泛型对象池：零运行期垃圾回收抖动，支持满池复用最老项的硬上限保护
 */
export class ObjectPool<T extends PoolItem> {
  private readonly items: T[] = [];
  private readonly stamps: number[] = [];
  private readonly factory: () => T;
  private readonly maxActive: number;
  private activeTotal = 0;
  private nextStamp = 1;
  private freeCursor = 0;

  constructor(factory: () => T, prewarmCount = 0, maxActive = 0) {
    this.factory = factory;
    this.maxActive = maxActive;
    for (let i = 0; i < prewarmCount; i++) {
      const item = this.factory();
      item.active = false;
      this.items.push(item);
      this.stamps.push(0);
    }
  }

  public acquire(): T {
    const len = this.items.length;

    // 达到硬上限时直接复用最老激活项（FIFO），防止峰值触发 GC 与渲染过载
    if (this.maxActive > 0 && this.activeTotal >= this.maxActive) {
      let oldestIdx = -1;
      let oldestStamp = Number.POSITIVE_INFINITY;
      for (let i = 0; i < len; i++) {
        if (this.items[i].active && this.stamps[i] < oldestStamp) {
          oldestStamp = this.stamps[i];
          oldestIdx = i;
        }
      }
      if (oldestIdx >= 0) {
        this.stamps[oldestIdx] = this.nextStamp++;
        return this.items[oldestIdx];
      }
    }

    for (let offset = 0; offset < len; offset++) {
      const idx = (this.freeCursor + offset) % len;
      const candidate = this.items[idx];
      if (!candidate.active) {
        candidate.active = true;
        this.stamps[idx] = this.nextStamp++;
        this.activeTotal += 1;
        this.freeCursor = (idx + 1) % len;
        return candidate;
      }
    }

    const created = this.factory();
    created.active = true;
    this.items.push(created);
    this.stamps.push(this.nextStamp++);
    this.activeTotal += 1;
    return created;
  }

  public release(item: T): void {
    if (!item.active) return;
    item.active = false;
    if (this.activeTotal > 0) {
      this.activeTotal -= 1;
    }
  }

  public releaseAll(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
      this.stamps[i] = 0;
    }
    this.activeTotal = 0;
    this.freeCursor = 0;
    this.nextStamp = 1;
  }

  public getRawItems(): readonly T[] {
    return this.items;
  }

  public forEachActive(callback: (item: T, index: number) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.active) {
        callback(item, i);
      }
    }
  }

  public get activeCount(): number {
    return this.activeTotal;
  }
}
