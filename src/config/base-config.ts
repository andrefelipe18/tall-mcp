/**
 * Base configuration for the application
 * Contains global settings and constants
 */
import * as path from "path";
import * as os from "os";

export class BaseConfig {
  /**
   * Whether logging is enabled
   */
  static readonly LOG_ENABLED = true;

  /**
   * Path to the log file
   */
  static readonly LOG_FILE = path.join(os.tmpdir(), "documentation-mcp-server.log");

  /**
   * Maximum size of the log file in bytes before it gets cleared
   * Default: 10MB
   */
  static readonly MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

  /**
   * Base path for documentation files
   * This is determined relative to the executing script
   */
  static readonly DOC_BASE_PATH = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../data"
  );
  
  /**
   * Path to Filament documentation
   */
  static readonly FILAMENT_DOCS_PATH = path.join(
    BaseConfig.DOC_BASE_PATH,
    "filament-docs"
  );
  
  /**
   * Path to Laravel documentation
   */
  static readonly LARAVEL_DOCS_PATH = path.join(
    BaseConfig.DOC_BASE_PATH,
    "laravel-docs"
  );
  
  /**
   * Path to Livewire documentation
   */
  static readonly LIVEWIRE_DOCS_PATH = path.join(
    BaseConfig.DOC_BASE_PATH,
    "livewire-docs"
  );
}