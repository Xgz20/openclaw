import { randomUUID } from "node:crypto";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { loadOrCreateDeviceIdentity } from "../device-identity.js";
import {
  onInternalDiagnosticEvent,
  type DiagnosticUsageEvent,
  type DiagnosticEventMetadata,
} from "../diagnostic-events.js";
import type { TelemetryConfig } from "./config.js";
import type { Reporter } from "./reporter.js";
import type { ModelUsageTelemetryEvent } from "./schema.js";

export class TelemetryCollector {
  private deviceId: string;
  private reporters: Reporter[];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private config: TelemetryConfig,
    reporters: Reporter[],
  ) {
    this.deviceId = loadOrCreateDeviceIdentity().deviceId;
    this.reporters = reporters;
  }

  start(): void {
    if (!this.config.enabled) {
      return;
    }

    this.unsubscribe = onInternalDiagnosticEvent((event, metadata: DiagnosticEventMetadata) => {
      if (event.type === "model.usage" && metadata.trusted) {
        this.handleModelUsageEvent(event);
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleModelUsageEvent(event: DiagnosticUsageEvent): void {
    try {
      const telemetryEvent = this.convertToTelemetryEvent(event);
      this.dispatchToReporters(telemetryEvent);
    } catch (err) {
      // Silently ignore conversion errors to avoid disrupting the main flow
    }
  }

  private convertToTelemetryEvent(event: DiagnosticUsageEvent): ModelUsageTelemetryEvent {
    // Parse session key to extract identity dimensions
    const sessionKey = event.sessionKey ?? "";
    const parsed = parseAgentSessionKey(sessionKey);

    // Extract peer_id from session key rest part
    // Format: agent:main:feishu:default:direct:U456
    // We need to extract the last part after "direct:"
    let peerId: string | null = null;
    let accountId = "default";

    if (parsed && parsed.rest) {
      const parts = parsed.rest.split(":");
      // Look for "direct:" pattern
      const directIndex = parts.indexOf("direct");
      if (directIndex >= 0 && directIndex < parts.length - 1) {
        peerId = parts[directIndex + 1];
      }
      // Look for account_id (usually before "direct")
      if (directIndex > 0) {
        accountId = parts[directIndex - 1];
      }
    }

    const agentId = parsed?.agentId ?? "main";
    const channel = event.channel ?? "unknown";

    // Extract W3C trace context
    const traceId = event.trace?.traceId ?? "";
    const spanId = event.trace?.spanId ?? "";

    return {
      $schema: "openclaw.model.usage.v1",
      event_id: randomUUID(),
      timestamp: event.ts,
      identity: {
        device_id: this.deviceId,
        session_key: sessionKey,
        agent_id: agentId,
        channel,
        account_id: accountId,
        peer_id: peerId,
      },
      model_call: {
        provider: event.provider ?? "unknown",
        model: event.model ?? "unknown",
        success: true,
        duration_ms: event.durationMs ?? 0,
        trace_id: traceId,
        span_id: spanId,
      },
      usage: {
        input_tokens: event.usage.input ?? 0,
        output_tokens: event.usage.output ?? 0,
        cache_read_tokens: event.usage.cacheRead ?? 0,
        cache_write_tokens: event.usage.cacheWrite ?? 0,
        total_tokens: event.usage.total ?? 0,
      },
      cost: {
        estimated_usd: event.costUsd ?? 0,
      },
    };
  }

  private dispatchToReporters(event: ModelUsageTelemetryEvent): void {
    // Fire-and-forget: dispatch to all reporters asynchronously
    for (const reporter of this.reporters) {
      reporter.report(event).catch(() => {
        // Silently ignore reporter errors
      });
    }
  }
}
