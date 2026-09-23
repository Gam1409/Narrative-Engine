export {};

declare global {
  interface Window {
    SillyTavern: {
      getContext(): Record<string, unknown>;
      libs?: Record<string, unknown>;
    };
    narrativeEngineInterceptor?: (
      chat: Array<Record<string, unknown>>,
      contextSize: number,
      abort: (immediately?: boolean) => void,
      type: string,
    ) => Promise<void>;
  }
}
