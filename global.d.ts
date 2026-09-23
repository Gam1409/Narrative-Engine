export {};

declare global {
  interface Window {
    SillyTavern: {
      getContext(): Record<string, unknown> & {
        ConnectionManagerRequestService?: {
          sendRequest(profileId: string, prompt: unknown, maxTokens: number, options?: Record<string, unknown>, overridePayload?: Record<string, unknown>): Promise<unknown>;
          getSupportedProfiles?(): Array<Record<string, unknown>>;
          getProfile?(profileId: string): Record<string, unknown>;
          validateProfile?(profile: Record<string, unknown>): Record<string, unknown>;
        };
      };
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
