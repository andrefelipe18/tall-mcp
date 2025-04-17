/**
 * Laravel documentation tool provider
 * Implements tools for working with Laravel documentation
 */
import { DocumentationService } from "../services/documentation-service.ts";
import { LogService } from "../services/log-service.ts";
import { BaseDocToolProvider } from "./base-doc-tools.ts";
import { ToolDefinition } from "./registry.ts";
import { BaseConfig } from "../config/base-config.ts";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Provider for Laravel documentation tools
 */
export class LaravelDocTools extends BaseDocToolProvider {
  protected basePath = BaseConfig.LARAVEL_DOCS_PATH;
  protected typePrefix = "laravel";

  constructor(docService: DocumentationService, logService: LogService) {
    super(docService, logService);
  }

  /**
   * Get all tool definitions for Laravel documentation
   * @returns Array of tool definitions
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      this.createToolDefinition(
        "docs",
        "Lists the available documentation files in the Laravel documentation",
        {
          path: {
            description: "Optional path within the documentation",
            type: "string",
          },
        }
      ),
      this.createToolDefinition(
        "doc",
        "Gets the content of a specific file from the Laravel documentation",
        {
          path: {
            description:
              "Path of the file within the documentation (e.g., 'installation', 'routing', etc.)",
            type: "string",
          },
        },
        ["path"]
      ),
      this.createToolDefinition(
        "search_docs",
        "Searches for a term in the entire local Laravel documentation",
        {
          query: {
            description:
              "Search term (e.g., 'route', 'middleware', 'config', etc.)",
            type: "string",
          },
        },
        ["query"]
      ),
    ];
  }

  /**
   * Execute a Laravel documentation tool
   * @param toolName Name of the tool to execute
   * @param args Arguments for the tool
   * @returns Result of the tool execution
   */
  async executeTool(toolName: string, args: any): Promise<any> {
    const baseName = toolName.replace(/^2d9_laravel_/, "");

    switch (baseName) {
      case "docs":
        return this.listLaravelDocs(args.path);
      case "doc":
        this.validateArgs(args, ["path"]);
        return this.getLaravelDoc(args.path);
      case "search_docs":
        this.validateArgs(args, ["query"]);
        return this.searchLaravelDocs(args.query);
      default:
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unknown Laravel tool: ${toolName}`
        );
    }
  }

  /**
   * Lists available Laravel documentation files
   * @param path Optional path within the documentation
   * @returns Array of file names
   */
  protected async listLaravelDocs(path?: string): Promise<string[]> {
    try {
      return await this.listDocs(path || "");
    } catch (error) {
      this.logService.error(
        `Failed to list Laravel docs${path ? " in " + path : ""}:`,
        error
      );
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list Laravel documentation${path ? " in " + path : ""}`
      );
    }
  }

  /**
   * Gets the content of a specific Laravel documentation file
   * @param path Path of the file within the documentation
   * @returns Content of the file
   */
  protected async getLaravelDoc(path: string): Promise<string> {
    return this.getDoc(path);
  }

  /**
   * Searches for a term in the Laravel documentation
   * @param query Search term
   * @returns Array of file paths containing the search term
   */
  protected async searchLaravelDocs(query: string): Promise<string[]> {
    return this.searchDocs(query);
  }
}
