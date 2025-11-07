export interface CapacitorPluginOutline {
    invokeMethod(options: { method: string; input: string }): Promise<{ value: string }>;
    start(options: { tunnelId: string; serverName: string; transportConfig: string }): Promise<void>;
    stop(options: { tunnelId: string }): Promise<void>;
    isRunning(options: { tunnelId: string }): Promise<{ isRunning: boolean }>;
    initializeErrorReporting(options: { apiKey: string }): Promise<void>;
    reportEvents(options: { uuid: string }): Promise<void>;
    quitApplication(): Promise<void>;
    addListener(eventName: 'vpnStatus', listenerFunc: (data: { id: string; status: number }) => void): Promise<any>;
}

