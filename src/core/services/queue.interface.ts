export const QUEUE_SERVICE = Symbol('QUEUE_SERVICE');

export interface IQueueService {
  publish(queue: string, message: unknown): Promise<void>;
}
