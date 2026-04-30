/**
 * Telemetry event schema for model usage tracking.
 * Schema version: openclaw.model.usage.v1
 */

export type ModelUsageTelemetryEvent = {
  /** Schema version identifier */
  $schema: "openclaw.model.usage.v1";

  /** Unique event ID for idempotency */
  event_id: string;

  /** Event timestamp in Unix milliseconds */
  timestamp: number;

  /** Identity dimensions for aggregation */
  identity: {
    /** Device unique identifier (SHA256 hex from device identity) */
    device_id: string;
    /** Full session key (e.g., agent:main:feishu:default:direct:U456) */
    session_key: string;
    /** Agent identifier parsed from session key */
    agent_id: string;
    /** Channel name (feishu, wechat, dingtalk, telegram, etc.) */
    channel: string;
    /** Account ID within the channel */
    account_id: string;
    /** Peer ID (user ID within the channel), null if not available */
    peer_id: string | null;
  };

  /** Model call information */
  model_call: {
    /** Provider identifier (anthropic, openai, google, etc.) */
    provider: string;
    /** Model identifier (claude-sonnet-4-6, gpt-4, etc.) */
    model: string;
    /** Success flag (always true for model.usage events) */
    success: true;
    /** Call duration in milliseconds */
    duration_ms: number;
    /** W3C Trace ID (32 hex chars) */
    trace_id: string;
    /** W3C Span ID (16 hex chars) */
    span_id: string;
  };

  /** Token usage breakdown */
  usage: {
    /** Input tokens */
    input_tokens: number;
    /** Output tokens */
    output_tokens: number;
    /** Cache read tokens */
    cache_read_tokens: number;
    /** Cache write tokens */
    cache_write_tokens: number;
    /** Total tokens */
    total_tokens: number;
  };

  /** Cost estimation */
  cost: {
    /** Estimated cost in USD */
    estimated_usd: number;
  };
};
