/** 从发起展示到 show() 成功的最长等待 */
export const AD_OPEN_TIMEOUT_MS = 15_000;
/** show() 成功后等待 onClose 的最长时间，仅用于回调丢失时解除暂停，需远大于单条广告时长 */
export const AD_CLOSE_TIMEOUT_MS = 180_000;

interface PendingShow<R> {
  resolve: (res: R) => void;
  failure: R;
  closeTimeout: R;
  opened: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 单个广告位的一次展示会话。结束途径只有四种：
 * 1. onClose（settle）
 * 2. 展示链整体失败
 * 3. 广告已打开后触发 onError（fail）
 * 4. 超时兜底
 * 展示链进行中的 onError 会被忽略，避免重试尚未结束就提前告知调用方失败。
 */
export class AdShowSession<R> {
  private pending: PendingShow<R> | null = null;

  public get busy(): boolean {
    return this.pending !== null;
  }

  /**
   * @param attempt 展示链。重试前需检查 isAlive()，会话已结束时不得再弹出广告
   */
  public run(
    attempt: (isAlive: () => boolean) => Promise<unknown>,
    failure: R,
    closeTimeout: R = failure,
  ): Promise<R> {
    return new Promise<R>((resolve) => {
      const current: PendingShow<R> = {
        resolve,
        failure,
        closeTimeout,
        opened: false,
        timer: setTimeout(() => this.settle(failure), AD_OPEN_TIMEOUT_MS),
      };
      this.pending = current;
      const isAlive = () => this.pending === current;
      const onOpenFailed = () => {
        if (isAlive()) this.settle(failure);
      };

      try {
        attempt(isAlive).then(() => {
          if (!isAlive()) return;
          current.opened = true;
          clearTimeout(current.timer);
          current.timer = setTimeout(
            () => this.settle(current.closeTimeout),
            AD_CLOSE_TIMEOUT_MS,
          );
        }, onOpenFailed);
      } catch {
        onOpenFailed();
      }
    });
  }

  /** 结束当前会话；没有进行中的会话时忽略 */
  public settle(res: R): void {
    const current = this.pending;
    if (!current) return;
    this.pending = null;
    clearTimeout(current.timer);
    current.resolve(res);
  }

  /** 对应广告实例的 onError */
  public fail(): void {
    const current = this.pending;
    if (current?.opened) {
      this.settle(current.failure);
    }
  }
}
