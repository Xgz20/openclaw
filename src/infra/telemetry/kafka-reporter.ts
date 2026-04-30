import type { Producer, Kafka, Message, SASLOptions } from "kafkajs";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { KafkaConfig } from "./config.js";
import type { Reporter } from "./reporter.js";
import type { ModelUsageTelemetryEvent } from "./schema.js";

const log = createSubsystemLogger("telemetry/kafka");

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

export class KafkaReporter implements Reporter {
  private producer: Producer | null = null;
  private kafkaInstance: Kafka | null = null;
  private buffer: Message[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  constructor(private config: KafkaConfig) {
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  async initialize(): Promise<boolean> {
    try {
      log.info("initializing kafka reporter", {
        brokers: this.config.brokers.join(","),
        topic: this.config.topic,
        clientId: this.config.clientId || "openclaw-telemetry",
        batchSize: this.batchSize,
        flushIntervalMs: this.flushIntervalMs,
      });

      const { Kafka, Partitioners } = await import("kafkajs");

      this.kafkaInstance = new Kafka({
        clientId: this.config.clientId || "openclaw-telemetry",
        brokers: this.config.brokers,
        ssl: this.config.ssl ?? false,
        sasl: this.config.sasl as SASLOptions | undefined,
      });

      this.producer = this.kafkaInstance.producer({
        allowAutoTopicCreation: true,
        transactionTimeout: 30000,
        // Use default partitioner (v2.0.0+) for better distribution
        createPartitioner: Partitioners.DefaultPartitioner,
      });

      await this.producer.connect();
      this.startFlushTimer();
      log.info("kafka producer connected");
      return true;
    } catch (err) {
      log.error("failed to initialize kafka reporter", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.producer = null;
      this.kafkaInstance = null;
      return false;
    }
  }

  async report(event: ModelUsageTelemetryEvent): Promise<void> {
    if (!this.producer) {
      log.warn("producer not initialized, skipping event");
      return;
    }

    const message: Message = {
      key: event.identity.device_id,
      value: JSON.stringify(event),
    };

    this.buffer.push(message);
    log.debug("event buffered", {
      eventId: event.event_id,
      bufferSize: this.buffer.length,
      batchSize: this.batchSize,
    });

    // Flush if batch size reached
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        log.error("flush timer error", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.flushIntervalMs);

    // Unref the timer so it doesn't keep the process alive
    if (typeof this.flushTimer === "object" && this.flushTimer) {
      const unref = (this.flushTimer as { unref?: () => void }).unref;
      if (unref) {
        unref.call(this.flushTimer);
      }
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0 || !this.producer) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0);

    try {
      log.debug("flushing batch", {
        messageCount: batch.length,
        topic: this.config.topic,
      });

      await this.producer.send({
        topic: this.config.topic,
        messages: batch,
        acks: this.config.acks ?? 1,
      });

      log.debug("batch sent", { messageCount: batch.length });
    } catch (err) {
      log.error("failed to send batch", {
        messageCount: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't re-add failed messages to buffer to avoid infinite retry
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    this.stopFlushTimer();

    // Flush remaining messages
    if (this.buffer.length > 0) {
      log.info("flushing remaining messages on close", { count: this.buffer.length });
      await this.flush();
    }

    if (this.producer) {
      try {
        await this.producer.disconnect();
        log.info("kafka producer disconnected");
      } catch {
        // Ignore disconnect errors
      }
      this.producer = null;
      this.kafkaInstance = null;
    }
  }
}
