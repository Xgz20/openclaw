import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { TelemetryConfig } from "./config.js";
import type { Reporter } from "./reporter.js";
import type { ModelUsageTelemetryEvent } from "./schema.js";

const log = createSubsystemLogger("telemetry/local");

type RotationConfig = TelemetryConfig["reporters"]["local"]["rotation"];

export class LocalReporter implements Reporter {
  private filePath: string;
  private rotation: RotationConfig;
  private dirEnsured = false;

  constructor(config: TelemetryConfig["reporters"]["local"]) {
    this.filePath = config.path;
    this.rotation = config.rotation;
  }

  async report(event: ModelUsageTelemetryEvent): Promise<void> {
    try {
      this.ensureDirectory();
      this.rotateIfNeeded();
      const line = JSON.stringify(event) + "\n";
      fs.appendFileSync(this.filePath, line, "utf8");
      log.debug("event written", {
        eventId: event.event_id,
        provider: event.model_call.provider,
        model: event.model_call.model,
        totalTokens: event.usage.total_tokens,
      });
    } catch (err) {
      log.error("failed to write event", {
        eventId: event.event_id,
        path: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async close(): Promise<void> {
    // No resources to release for file-based reporter
  }

  private ensureDirectory(): void {
    if (this.dirEnsured) {
      return;
    }
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    this.dirEnsured = true;
    log.debug("ensured directory", { dir });
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }

      const stat = fs.statSync(this.filePath);
      const sizeExceeded = stat.size >= this.rotation.maxSizeMb * 1024 * 1024;
      const ageExceeded =
        Date.now() - stat.mtimeMs >= this.rotation.maxAgeDays * 24 * 60 * 60 * 1000;

      if (sizeExceeded || ageExceeded) {
        log.info("rotating file", {
          path: this.filePath,
          sizeMb: Math.round(stat.size / 1024 / 1024),
          ageDays: Math.round((Date.now() - stat.mtimeMs) / 86400000),
          reason: sizeExceeded ? "size" : "age",
        });
        this.performRotation();
      }
    } catch (err) {
      log.warn("rotation check failed", {
        path: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private performRotation(): void {
    // Shift existing rotated files: .N -> .N+1
    for (let i = this.rotation.maxFiles; i >= 1; i--) {
      const src = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      const dst = `${this.filePath}.${i}`;

      if (i >= this.rotation.maxFiles) {
        // Delete the oldest file
        try {
          fs.unlinkSync(dst);
        } catch {
          // File may not exist
        }
      }

      try {
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst);
        }
      } catch (err) {
        log.warn("rotation rename failed", {
          src,
          dst,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    log.info("rotation completed", { path: this.filePath });
  }
}
