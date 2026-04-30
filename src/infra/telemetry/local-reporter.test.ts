import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelemetryConfig } from "./config.js";
import { LocalReporter } from "./local-reporter.js";
import type { ModelUsageTelemetryEvent } from "./schema.js";

describe("LocalReporter", () => {
  let tempDir: string;
  let config: TelemetryConfig["reporters"]["local"];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join("/tmp", "telemetry-test-"));
    config = {
      enabled: true,
      path: path.join(tempDir, "usage.jsonl"),
      rotation: {
        maxSizeMb: 1, // 1MB for testing
        maxAgeDays: 1,
        maxFiles: 3,
      },
    };
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should create directory and write event to file", async () => {
    const reporter = new LocalReporter(config);

    const event: ModelUsageTelemetryEvent = {
      $schema: "openclaw.model.usage.v1",
      event_id: "test-event-id",
      timestamp: Date.now(),
      identity: {
        device_id: "device-123",
        session_key: "agent:main:feishu:default:direct:U456",
        agent_id: "main",
        channel: "feishu",
        account_id: "default",
        peer_id: "U456",
      },
      model_call: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        success: true,
        duration_ms: 2000,
        trace_id: "e00d3297e65f07591fdfdac57dc8c837",
        span_id: "0ba9d8be54a9aa4a",
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 20,
        cache_write_tokens: 10,
        total_tokens: 180,
      },
      cost: {
        estimated_usd: 0.005,
      },
    };

    await reporter.report(event);

    expect(fs.existsSync(config.path)).toBe(true);
    const content = fs.readFileSync(config.path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(event);
  });

  it("should append multiple events", async () => {
    const reporter = new LocalReporter(config);

    const event1: ModelUsageTelemetryEvent = {
      $schema: "openclaw.model.usage.v1",
      event_id: "event-1",
      timestamp: Date.now(),
      identity: {
        device_id: "device-123",
        session_key: "",
        agent_id: "main",
        channel: "feishu",
        account_id: "default",
        peer_id: null,
      },
      model_call: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        success: true,
        duration_ms: 2000,
        trace_id: "",
        span_id: "",
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 150,
      },
      cost: {
        estimated_usd: 0.005,
      },
    };

    const event2 = { ...event1, event_id: "event-2" };

    await reporter.report(event1);
    await reporter.report(event2);

    const content = fs.readFileSync(config.path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event_id).toBe("event-1");
    expect(JSON.parse(lines[1]).event_id).toBe("event-2");
  });

  it("should rotate file when size exceeds maxSizeMb", async () => {
    const rotationConfig = {
      ...config,
      rotation: { ...config.rotation, maxSizeMb: 0.0005 },
    };
    const reporter = new LocalReporter(rotationConfig);

    const event: ModelUsageTelemetryEvent = {
      $schema: "openclaw.model.usage.v1",
      event_id: "x".repeat(200),
      timestamp: Date.now(),
      identity: {
        device_id: "device-123",
        session_key: "",
        agent_id: "main",
        channel: "feishu",
        account_id: "default",
        peer_id: null,
      },
      model_call: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        success: true,
        duration_ms: 2000,
        trace_id: "",
        span_id: "",
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 150,
      },
      cost: {
        estimated_usd: 0.005,
      },
    };

    // ~524 bytes threshold; each event line is ~500+ bytes
    await reporter.report(event);
    await reporter.report(event);

    expect(fs.existsSync(rotationConfig.path)).toBe(true);
    expect(fs.existsSync(`${rotationConfig.path}.1`)).toBe(true);
  });

  it("should delete old files when exceeding maxFiles", async () => {
    const reporter = new LocalReporter(config);

    // Create initial rotated files
    fs.writeFileSync(config.path, "old content\n");
    fs.writeFileSync(`${config.path}.1`, "old content 1\n");
    fs.writeFileSync(`${config.path}.2`, "old content 2\n");
    fs.writeFileSync(`${config.path}.3`, "old content 3\n");

    // Trigger rotation by writing a large event
    const largeEvent: ModelUsageTelemetryEvent = {
      $schema: "openclaw.model.usage.v1",
      event_id: "x".repeat(500000),
      timestamp: Date.now(),
      identity: {
        device_id: "device-123",
        session_key: "",
        agent_id: "main",
        channel: "feishu",
        account_id: "default",
        peer_id: null,
      },
      model_call: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        success: true,
        duration_ms: 2000,
        trace_id: "",
        span_id: "",
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 150,
      },
      cost: {
        estimated_usd: 0.005,
      },
    };

    await reporter.report(largeEvent);
    await reporter.report(largeEvent);

    // Check that old files were deleted (maxFiles = 3)
    expect(fs.existsSync(config.path)).toBe(true);
    expect(fs.existsSync(`${config.path}.1`)).toBe(true);
    expect(fs.existsSync(`${config.path}.2`)).toBe(true);
    expect(fs.existsSync(`${config.path}.3`)).toBe(true);
    // .4 should not exist (deleted due to maxFiles limit)
    expect(fs.existsSync(`${config.path}.4`)).toBe(false);
  });

  it("should silently ignore write errors", async () => {
    // Use an invalid path to trigger write error
    config.path = "/invalid/path/usage.jsonl";
    const reporter = new LocalReporter(config);

    const event: ModelUsageTelemetryEvent = {
      $schema: "openclaw.model.usage.v1",
      event_id: "test-event-id",
      timestamp: Date.now(),
      identity: {
        device_id: "device-123",
        session_key: "",
        agent_id: "main",
        channel: "unknown",
        account_id: "default",
        peer_id: null,
      },
      model_call: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        success: true,
        duration_ms: 2000,
        trace_id: "",
        span_id: "",
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 150,
      },
      cost: {
        estimated_usd: 0.005,
      },
    };

    // Should not throw
    await expect(reporter.report(event)).resolves.toBeUndefined();
  });
});
