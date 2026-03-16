export declare const QUEUE_SERVICE: unique symbol;
export interface IQueueService {
    publish(queue: string, message: unknown): Promise<void>;
}
