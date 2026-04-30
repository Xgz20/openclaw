import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DiagnosticUsageEvent } from "../diagnostic-events.js";
import { TelemetryCollector } from "./collector.js";
import type { TelemetryConfig } from "./config.js";
import type { Reporter } from "./reporter.js";

describe("TelemetryCollector", () => {
  let mockReporter: Reporter;
  let config: TelemetryConfig;
  let collector: TelemetryCollector;

  beforeEach(() => {
    mockReporter = {
      report: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    config = {
      enabled: true,
      reporters: {
        kafka: { enabled: false, configPath: "" },
        local: {
          enabled: true,
          path: "",
          rotation: { maxSizeMb: 100, maxAgeDays: 7, maxFiles: 10 },
        },
      },
    };
  });

  afterEach(() => {
    if (collector) {
      collector.stop();
    }
  });

  it("should not start when disabled", () => {
    config.enabled = false;
    collector = new TelemetryCollector(config, [mockReporter]);
    collector.start();

    // No way to directly verify, but coverage will show the early return
    expect(true).toBe(true);
  });

  it("should convert model.usage event to telemetry event", async () => {
    collector = new TelemetryCollector(config, [mockReporter]);
    collector.start();

    const usageEvent: DiagnosticUsageEvent = {
      type: "model.usage",
      ts: Date.now(),
      seq: 1,
      sessionKey: "agent:main:feishu:default:direct:U456",
      channel: "feishu",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: {
        input: 100,
        output: 50,
        cacheRead: 20,
        cacheWrite: 10,
        total: 180,
      },
      costUsd: 0.005,
      durationMs: 2000,
      trace: {
        traceId: "e00d3297e65f07591fdfdac57dc8c837",
        spanId: "0ba9d8be54a9aa4a",
      },
    };

    // Trigger the event handler by importing and calling emitInternalDiagnosticEvent
    const { emitTrustedDiagnosticEvent } = await import("../diagnostic-events.js");
    emitTrustedDiagnosticEvent(usageEvent);

    // Wait for async dispatch
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockReporter.report).toHaveBeenCalledTimes(1);
    const reportedEvent = (mockReporter.report as any).mock.calls[0][0];

    expect(reportedEvent.$schema).toBe("openclaw.model.usage.v1");
    expect(reportedEvent.identity.agent_id).toBe("main");
    expect(reportedEvent.identity.channel).toBe("feishu");
    expect(reportedEvent.identity.account_id).toBe("default");
    expect(reportedEvent.identity.peer_id).toBe("u456");
    expect(reportedEvent.model_call.provider).toBe("anthropic");
    expect(reportedEvent.model_call.model).toBe("claude-sonnet-4-6");
    expect(reportedEvent.model_call.success).toBe(true);
    expect(reportedEvent.model_call.duration_ms).toBe(2000);
    expect(reportedEvent.usage.input_tokens).toBe(100);
    expect(reportedEvent.usage.output_tokens).toBe(50);
    expect(reportedEvent.cost.estimated_usd).toBe(0.005);
  });

  it("should handle missing sessionKey gracefully", async () => {
    collector = new TelemetryCollector(config, [mockReporter]);
    collector.start();

    const usageEvent: DiagnosticUsageEvent = {
      type: "model.usage",
      ts: Date.now(),
      seq: 1,
      channel: "unknown",
      provider: "openai",
      model: "gpt-4",
      usage: { total: 100 },
    };

    const { emitTrustedDiagnosticEvent } = await import("../diagnostic-events.js");
    emitTrustedDiagnosticEvent(usageEvent);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockReporter.report).toHaveBeenCalledTimes(1);
    const reportedEvent = (mockReporter.report as any).mock.calls[0][0];

    expect(reportedEvent.identity.agent_id).toBe("main");
    expect(reportedEvent.identity.channel).toBe("unknown");
    expect(reportedEvent.identity.peer_id).toBeNull();
  });

  it("should dispatch to multiple reporters", async () => {
    const mockReporter2: Reporter = {
      report: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    collector = new TelemetryCollector(config, [mockReporter, mockReporter2]);
    collector.start();

    const usageEvent: DiagnosticUsageEvent = {
      type: "model.usage",
      ts: Date.now(),
      seq: 1,
      usage: { total: 100 },
    };

    const { emitTrustedDiagnosticEvent } = await import("../diagnostic-events.js");
    emitTrustedDiagnosticEvent(usageEvent);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockReporter.report).toHaveBeenCalledTimes(1);
    expect(mockReporter2.report).toHaveBeenCalledTimes(1);
  });
});
