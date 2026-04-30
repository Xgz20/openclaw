import { createSubsystemLogger } from "../../logging/subsystem.js";
import { TelemetryCollector } from "./collector.js";
import { loadTelemetryConfig, loadKafkaConfig } from "./config.js";
import { KafkaReporter } from "./kafka-reporter.js";
import { LocalReporter } from "./local-reporter.js";
import type { Reporter } from "./reporter.js";

const log = createSubsystemLogger("telemetry");

let collector: TelemetryCollector | null = null;
let reporters: Reporter[] = [];

export async function initializeTelemetry(): Promise<void> {
  try {
    log.info("starting telemetry initialization");
    const config = loadTelemetryConfig();

    log.info("loaded config", {
      enabled: config.enabled,
      kafkaEnabled: config.reporters.kafka.enabled,
      localEnabled: config.reporters.local.enabled,
      localPath: config.reporters.local.path,
    });

    if (!config.enabled) {
      log.info("telemetry disabled in config");
      return;
    }

    // Initialize reporters
    reporters = [];

    // Initialize Kafka reporter if enabled
    if (config.reporters.kafka.enabled) {
      const kafkaConfig = loadKafkaConfig(config.reporters.kafka.configPath);
      if (kafkaConfig) {
        const kafkaReporter = new KafkaReporter(kafkaConfig);
        const initialized = await kafkaReporter.initialize();
        if (initialized) {
          reporters.push(kafkaReporter);
        }
      } else {
        log.warn("kafka config not found or invalid", {
          configPath: config.reporters.kafka.configPath,
        });
      }
    }

    // Initialize Local reporter if enabled
    if (config.reporters.local.enabled) {
      const localReporter = new LocalReporter(config.reporters.local);
      reporters.push(localReporter);
      log.info("local reporter initialized", { path: config.reporters.local.path });
    }

    // Initialize collector
    collector = new TelemetryCollector(config, reporters);
    collector.start();
    log.info("telemetry collector started", { reporterCount: reporters.length });
  } catch (err) {
    log.error("telemetry initialization failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    collector = null;
    reporters = [];
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (collector) {
    collector.stop();
    collector = null;
  }

  // Close all reporters
  await Promise.all(reporters.map((r) => r.close().catch(() => {})));
  reporters = [];
}
