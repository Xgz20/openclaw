import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolveRequiredHomeDir } from "../home-dir.js";

export type TelemetryConfig = {
  /** Enable or disable telemetry collection */
  enabled: boolean;

  /** Reporter configurations */
  reporters: {
    /** Kafka reporter configuration */
    kafka: {
      /** Enable Kafka reporter */
      enabled: boolean;
      /** Path to Kafka connection config file */
      configPath: string;
    };

    /** Local file reporter configuration */
    local: {
      /** Enable local file reporter */
      enabled: boolean;
      /** Path to JSON Lines output file */
      path: string;
      /** File rotation configuration */
      rotation: {
        /** Maximum file size in MB before rotation */
        maxSizeMb: number;
        /** Maximum file age in days before rotation */
        maxAgeDays: number;
        /** Maximum number of rotated files to keep */
        maxFiles: number;
      };
    };
  };
};

export type KafkaConfig = {
  /** Kafka broker addresses */
  brokers: string[];
  /** Kafka topic name */
  topic: string;
  /** Kafka client ID */
  clientId: string;
  /** SASL authentication (optional) */
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
  /** Enable SSL/TLS */
  ssl?: boolean;
  /** Producer acknowledgment level */
  acks?: 0 | 1 | -1;
  /** Batch size for batching messages */
  batchSize?: number;
  /** Flush interval in milliseconds */
  flushIntervalMs?: number;
};

function resolveConfigPath(filePath: string): string {
  // Handle tilde paths: ~/...
  if (filePath.startsWith("~/")) {
    const homeDir = resolveRequiredHomeDir();
    return path.join(homeDir, filePath.slice(2));
  }

  // Handle absolute paths
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // Handle relative paths: resolve relative to state dir
  const stateDir = resolveStateDir();
  return path.join(stateDir, filePath);
}

function defaultTelemetryConfig(): TelemetryConfig {
  const stateDir = resolveStateDir();
  return {
    enabled: true,
    reporters: {
      kafka: {
        enabled: false,
        configPath: path.join(stateDir, "telemetry", "kafka.json"),
      },
      local: {
        enabled: true,
        path: path.join(stateDir, "telemetry", "usage.jsonl"),
        rotation: {
          maxSizeMb: 100,
          maxAgeDays: 7,
          maxFiles: 10,
        },
      },
    },
  };
}

export function loadTelemetryConfig(): TelemetryConfig {
  try {
    const stateDir = resolveStateDir();
    const configPath = path.join(stateDir, "telemetry", "config.json");
    const defaults = defaultTelemetryConfig();

    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TelemetryConfig>;

    // Merge with defaults
    const config: TelemetryConfig = {
      enabled: parsed.enabled ?? defaults.enabled,
      reporters: {
        kafka: {
          enabled: parsed.reporters?.kafka?.enabled ?? defaults.reporters.kafka.enabled,
          configPath: parsed.reporters?.kafka?.configPath ?? defaults.reporters.kafka.configPath,
        },
        local: {
          enabled: parsed.reporters?.local?.enabled ?? defaults.reporters.local.enabled,
          path: parsed.reporters?.local?.path ?? defaults.reporters.local.path,
          rotation: {
            maxSizeMb:
              parsed.reporters?.local?.rotation?.maxSizeMb ??
              defaults.reporters.local.rotation.maxSizeMb,
            maxAgeDays:
              parsed.reporters?.local?.rotation?.maxAgeDays ??
              defaults.reporters.local.rotation.maxAgeDays,
            maxFiles:
              parsed.reporters?.local?.rotation?.maxFiles ??
              defaults.reporters.local.rotation.maxFiles,
          },
        },
      },
    };

    // Resolve paths (supports absolute, relative, and tilde paths)
    config.reporters.kafka.configPath = resolveConfigPath(config.reporters.kafka.configPath);
    config.reporters.local.path = resolveConfigPath(config.reporters.local.path);

    return config;
  } catch (err) {
    // On error, return default config
    return defaultTelemetryConfig();
  }
}

export function loadKafkaConfig(configPath: string): KafkaConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as KafkaConfig;

    // Validate required fields
    if (!parsed.brokers || !Array.isArray(parsed.brokers) || parsed.brokers.length === 0) {
      return null;
    }
    if (!parsed.topic || typeof parsed.topic !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
