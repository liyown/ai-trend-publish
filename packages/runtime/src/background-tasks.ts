export interface BackgroundTasks {
  start(name: string, task: () => Promise<unknown>): void;
}
