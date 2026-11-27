import type { PoolItem } from './types';

/**
 * 固定结构泛型对象池：零运行期垃圾回收抖动，保证中低端设备 60 帧流畅运行
 */
export class ObjectPool<T extends PoolItem> {
  private readonly items: T[] = [];
  private readonly factory: () => T;
  private activeTotal = 0;

  constructor(factory: () => T, prewarmCount = 0) {
    this.factory = factory;
    for (let i = 0; i < prewarmCount; i++) {
      const item = this.factory();
      item.active = false;
      this.items.push(item);
    }
  }

  public acquire(): T {
    for (let i = 0; i < this.items.length; i++) {
      const candidate = this.items[i];
      if (!candidate.active) {
        candidate.active = true;
        this.activeTotal += 1;
        return candidate;
      }
    }
    const created = this.factory();
    created.active = true;
    this.items.push(created);
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
    }
    this.activeTotal = 0;
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
