# Model Usage Telemetry

OpenClaw can collect model usage metrics (token counts, cost, duration) and report them to Kafka or local files for downstream analytics, alerting, and cost tracking.

## Quick Start

1. Copy the example config to your OpenClaw home directory:

```bash
mkdir -p ~/.openclaw/telemetry
cp docs/telemetry/config.json.example ~/.openclaw/telemetry/config.json
```

2. Restart the gateway. Telemetry starts collecting automatically with local file output enabled by default.

3. Verify data is being collected:

```bash
tail -f ~/.openclaw/telemetry/usage.jsonl | jq .
```

## Configuration

### Main Config (`~/.openclaw/telemetry/config.json`)

| Field                                 | Type    | Default                             | Description                                   |
| ------------------------------------- | ------- | ----------------------------------- | --------------------------------------------- |
| `enabled`                             | boolean | `true`                              | Global on/off switch for telemetry collection |
| `reporters.kafka.enabled`             | boolean | `false`                             | Enable Kafka reporter                         |
| `reporters.kafka.configPath`          | string  | `~/.openclaw/telemetry/kafka.json`  | Path to Kafka connection config               |
| `reporters.local.enabled`             | boolean | `true`                              | Enable local JSON Lines file reporter         |
| `reporters.local.path`                | string  | `~/.openclaw/telemetry/usage.jsonl` | Output file path                              |
| `reporters.local.rotation.maxSizeMb`  | number  | `100`                               | Rotate when file exceeds this size (MB)       |
| `reporters.local.rotation.maxAgeDays` | number  | `7`                                 | Rotate when file is older than this (days)    |
| `reporters.local.rotation.maxFiles`   | number  | `10`                                | Maximum number of rotated files to keep       |

### Kafka Config (`~/.openclaw/telemetry/kafka.json`)

| Field            | Type         | Required | Description                                               |
| ---------------- | ------------ | -------- | --------------------------------------------------------- |
| `brokers`        | string[]     | Yes      | Kafka broker addresses                                    |
| `topic`          | string       | Yes      | Kafka topic name                                          |
| `clientId`       | string       | No       | Kafka client ID (default: `openclaw-telemetry`)           |
| `acks`           | 0 \| 1 \| -1 | No       | Producer acknowledgment level (default: `1`)              |
| `ssl`            | boolean      | No       | Enable SSL/TLS (default: `false`)                         |
| `sasl.mechanism` | string       | No       | SASL mechanism: `plain`, `scram-sha-256`, `scram-sha-512` |
| `sasl.username`  | string       | No       | SASL username                                             |
| `sasl.password`  | string       | No       | SASL password                                             |

Kafka reporting requires `kafkajs` to be installed:

```bash
pnpm add kafkajs
```

If `kafkajs` is not installed, the Kafka reporter is automatically disabled.

## Event Schema (`openclaw.model.usage.v1`)

Each telemetry event contains:

- **identity**: `device_id`, `session_key`, `agent_id`, `channel`, `account_id`, `peer_id`
- **model_call**: `provider`, `model`, `success`, `duration_ms`, `call_id`, `run_id`
- **usage**: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`
- **cost**: `estimated_usd`

Kafka partition key is `device_id` (one device = one user, events ordered per user).

## File Rotation

Local files rotate when either condition is met:

- File size exceeds `maxSizeMb`
- File age exceeds `maxAgeDays`

Rotated files are named `usage.jsonl.1`, `usage.jsonl.2`, etc. Files beyond `maxFiles` are deleted automatically.
