import { Injectable } from '@nestjs/common';

/**
 * Координация отмены публикации: флаг + немедленный вызов deleteSession у активной WebdriverIO-сессии,
 * чтобы Appium перестал опрашивать устройство после отмены поста в UI.
 */
@Injectable()
export class PublishCancellationRegistry {
  private readonly cancelledIds = new Set<string>();
  private readonly sessionClosers = new Map<string, () => Promise<void>>();

  /** Вызывается из API отмены: помечаем пост и закрываем сессию Appium, если она уже открыта. */
  requestCancel(postId: string): void {
    this.cancelledIds.add(postId);
    const close = this.sessionClosers.get(postId);
    if (close) void close();
  }

  throwIfCancelled(postId: string): void {
    if (this.cancelledIds.has(postId)) {
      throw new Error('Публикация отменена');
    }
  }

  registerSessionCloser(postId: string, closer: () => Promise<void>): void {
    this.sessionClosers.set(postId, closer);
  }

  unregisterSessionCloser(postId: string): void {
    this.sessionClosers.delete(postId);
  }

  clearCancelled(postId: string): void {
    this.cancelledIds.delete(postId);
  }
}
