/**
 * Log service for the application
 * Handles logging of information, warnings, and errors
 */
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

/**
 * Service for handling logs throughout the application
 */
export class LogService {
  private enabled: boolean;
  private logFilePath: string;

  /**
   * Creates a new LogService instance
   * @param enabled Whether logging to file is enabled
   * @param logFilePath Path to the log file
   */
  constructor(enabled: boolean, logFilePath: string) {
    this.enabled = enabled;
    this.logFilePath = logFilePath;
    
    // Ensure log directory exists
    if (enabled) {
      const logDir = path.dirname(logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  /**
   * Logs an informational message
   * @param message The message to log
   * @param data Optional data to include in the log
   */
  info(message: string, data?: any): void {
    this.log("INFO", message, data);
  }

  /**
   * Logs a warning message
   * @param message The warning message to log
   * @param data Optional data to include in the log
   */
  warn(message: string, data?: any): void {
    this.log("WARN", message, data);
  }

  /**
   * Logs an error message
   * @param message The error message to log
   * @param error Optional error object to include in the log
   */
  error(message: string, error?: any): void {
    this.log("ERROR", message, error);
  }

  /**
   * Internal method to handle the actual logging
   * @param level The log level
   * @param message The message to log
   * @param data Optional data to include
   */
  private log(level: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    // Always log to console
    console.log(logMessage);
    if (data) {
      console.log(data);
    }
    
    // Log to file if enabled
    if (this.enabled) {
      try {
        const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : "";
        fs.appendFileSync(
          this.logFilePath,
          `${logMessage}${dataStr}\n`
        );
      } catch (error) {
        console.error("Failed to write to log file:", error);
      }
    }
  }
}