export interface CapacitorGoPluginPlugin {
  echo(options: { value: string }): Promise<{ value: string }>;
}
