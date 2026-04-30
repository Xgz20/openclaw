import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryCollector } from "./collector.js";
import type { TelemetryConfig } from "./config.js";
import { LocalReporter } from "./local-reporter.js";
import type { Reporter } from "./reporter.js";
import type { ModelUsageTelemetryEvent } from "./schema.js";

function createTestEvent(overrides?: Partial<ModelUsageTelemetryEvent>): ModelUsageTelemetryEvent {
  return {
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
      call_id: "call-123",
      run_id: "run-456",
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
    ...overrides,
  };
}

describe("Telemetry Integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join("/tmp", "telemetry-integration-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("8.1 End-to-end: model.usage → telemetry event → local file", () => {
    it("should write telemetry event to local file when model.usage is emitted", async () => {
      const filePath = path.join(tempDir, "usage.jsonl");
      const localConfig: TelemetryConfig["reporters"]["local"] = {
        enabled: true,
        path: filePath,
        rotation: { maxSizeMb: 100, maxAgeDays: 7, maxFiles: 10 },
      };

      const localReporter = new LocalReporter(localConfig);
      const config: TelemetryConfig = {
        enabled: true,
        reporters: {
          kafka: { enabled: false, configPath: "" },
          local: localConfig,
        },
      };

      const collector = new TelemetryCollector(config, [localReporter]);
      collector.start();

      // Emit a model.usage diagnostic event
      const { emitDiagnosticEvent } = await import("../diagnostic-events.js");
      emitDiagnosticEvent({
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
      });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      collector.stop();

      // Verify file was written
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const event = JSON.parse(lines[0]) as ModelUsageTelemetryEvent;
      expect(event.$schema).toBe("openclaw.model.usage.v1");
      expect(event.identity.channel).toBe("feishu");
      expect(event.identity.peer_id).toBe("u456");
      expect(event.model_call.provider).toBe("anthropic");
      expect(event.usage.input_tokens).toBe(100);
      expect(event.usage.output_tokens).toBe(50);
      expect(event.cost.estimated_usd).toBe(0.005);
    });
  });

  describe("8.3 File rotation", () => {
    it("should rotate files when size exceeds limit", async () => {
      const filePath = path.join(tempDir, "usage.jsonl");
      const localConfig: TelemetryConfig["reporters"]["local"] = {
        enabled: true,
        path: filePath,
        rotation: { maxSizeMb: 0.001, maxAgeDays: 7, maxFiles: 3 }, // ~1KB limit
      };

      const localReporter = new LocalReporter(localConfig);

      // Write enough events to trigger rotation
      for (let i = 0; i < 10; i++) {
        await localReporter.report(createTestEvent({ event_id: `event-${i}` }));
      }

      // Verify rotation occurred
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    });

    it("should clean up old files beyond maxFiles", async () => {
      const filePath = path.join(tempDir, "usage.jsonl");
      const localConfig: TelemetryConfig["reporters"]["local"] = {
        enabled: true,
        path: filePath,
        rotation: { maxSizeMb: 0.001, maxAgeDays: 7, maxFiles: 2 }, // ~1KB limit, keep 2 files
      };

      const localReporter = new LocalReporter(localConfig);

      // Write many events to trigger multiple rotations
      for (let i = 0; i < 30; i++) {
        await localReporter.report(createTestEvent({ event_id: `event-${i}` }));
      }

      // Verify maxFiles is respected
      expect(fs.existsSync(filePath)).toBe(true);
      // Files beyond maxFiles should be cleaned up
      const files = fs.readdirSync(tempDir).filter((f) => f.startsWith("usage.jsonl"));
      expect(files.length).toBeLessThanOrEqual(3); // current + maxFiles rotated
    });
  });

  describe("8.4 Collector disabled", () => {
    it("should not subscribe to events when disabled", async () => {
      const mockReporter: Reporter = {
        report: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const config: TelemetryConfig = {
        enabled: false,
        reporters: {
          kafka: { enabled: false, configPath: "" },
          local: {
            enabled: true,
            path: path.join(tempDir, "usage.jsonl"),
            rotation: { maxSizeMb: 100, maxAgeDays: 7, maxFiles: 10 },
          },
        },
      };

      const collector = new TelemetryCollector(config, [mockReporter]);
      collector.start();

      // Emit a model.usage event
      const { emitDiagnosticEvent } = await import("../diagnostic-events.js");
      emitDiagnosticEvent({
        type: "model.usage",
        ts: Date.now(),
        seq: 1,
        usage: { total: 100 },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      collector.stop();

      // Reporter should not have been called
      expect(mockReporter.report).not.toHaveBeenCalled();
    });
  });

  describe("8.5 Kafka reporter without kafkajs", () => {
    it("should gracefully handle missing kafkajs", async () => {
      // KafkaReporter uses dynamic import, which will fail if kafkajs is not installed
      const { KafkaReporter } = await import("./kafka-reporter.js");
      const reporter = new KafkaReporter({
        brokers: ["localhost:9092"],
        topic: "test",
        clientId: "test",
      });

      // initialize() should return false when kafkajs is not available
      const initialized = await reporter.initialize();

      // In test environment, kafkajs may or may not be installed
      // The key assertion is that it doesn't throw
      if (!initialized) {
        // report() should be a no-op when not initialized
        await expect(reporter.report(createTestEvent())).resolves.toBeUndefined();
      }

      // close() should be safe even when not initialized
      await expect(reporter.close()).resolves.toBeUndefined();
    });
  });
});
