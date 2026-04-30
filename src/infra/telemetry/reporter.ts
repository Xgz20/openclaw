import type { ModelUsageTelemetryEvent } from "./schema.js";

/**
 * Reporter interface for telemetry event reporting.
 * Implementations should handle errors internally and never throw.
 */
export interface Reporter {
  /**
   * Report a telemetry event.
   * This method should be fire-and-forget and never throw errors.
   * @param event The telemetry event to report
   */
  report(event: ModelUsageTelemetryEvent): Promise<void>;

  /**
   * Close the reporter and release resources.
   * Called during shutdown.
   */
  close(): Promise<void>;
}
