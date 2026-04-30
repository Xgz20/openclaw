import { describe, it, expect } from "vitest";
import type { KafkaConfig } from "./config.js";
import { KafkaReporter } from "./kafka-reporter.js";
import type { ModelUsageTelemetryEvent } from "./schema.js";

describe("KafkaReporter", () => {
  const config: KafkaConfig = {
    brokers: ["localhost:9092"],
    topic: "openclaw.model.usage",
    clientId: "openclaw-test",
    acks: 1,
  };

  const createTestEvent = (): ModelUsageTelemetryEvent => ({
    $schema: "openclaw.model.usage.v1",
    event_id: "test-event-123",
    timestamp: Date.now(),
    identity: {
      device_id: "device-abc",
      session_key: "agent:main:feishu:default:direct:u123",
      agent_id: "main",
      channel: "feishu",
      account_id: "default",
      peer_id: "u123",
    },
    model_call: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      success: true,
      duration_ms: 1500,
      call_id: "call-123",
      run_id: "run-456",
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
  });

  it("should handle kafkajs not installed gracefully", async () => {
    const reporter = new KafkaReporter(config);
    const initialized = await reporter.initialize();

    expect(typeof initialized).toBe("boolean");
  });

  it("should not throw when reporting without initialization", async () => {
    const reporter = new KafkaReporter(config);

    await expect(reporter.report(createTestEvent())).resolves.toBeUndefined();
  });

  it("should not throw when closing without initialization", async () => {
    const reporter = new KafkaReporter(config);

    await expect(reporter.close()).resolves.toBeUndefined();
  });
});
