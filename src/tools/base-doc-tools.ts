/**
 * Base abstract class for documentation tool providers
 * Provides common functionality for all documentation tools
 */
import { DocumentationService } from "../services/documentation-service.ts";
import { LogService } from "../services/log-service.ts";
import { ToolDefinition, ToolProvider } from "./registry.ts";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Abstract base class for documentation tool providers
 * Implements common functionality and defines the interface for specific providers
 */
export abstract class BaseDocToolProvider implements ToolProvider {
  protected docService: DocumentationService;
  protected logService: LogService;
  
  /**
   * Base path for this documentation provider
   */
  protected abstract basePath: string;
  
  /**
   * Type prefix for the tools (e.g., 'filament', 'laravel', 'livewire')
   */
  protected abstract typePrefix: string;
  
  constructor(docService: DocumentationService, logService: LogService) {
    this.docService = docService;
    this.logService = logService;
  }
  
  /**
   * Gets all tool definitions from this provider
   * @returns Array of tool definitions
   */
  abstract getToolDefinitions(): ToolDefinition[];
  
  /**
   * Executes a tool by name with the provided arguments
   * @param toolName Name of the tool to execute
   * @param args Arguments for the tool
   * @returns Result of the tool execution
   */
  abstract executeTool(toolName: string, args: any): Promise<any>;
  
  /**
   * Creates a standard tool definition with the appropriate prefix
   * @param name Base name of the tool (without prefix)
   * @param description Tool description
   * @param properties Parameter properties
   * @param required Required parameters
   * @returns A complete tool definition
   */
  protected createToolDefinition(
    name: string,
    description: string,
    properties: Record<string, any>,
    required: string[] = []
  ): ToolDefinition {
    return {
      name: `2d9_${this.typePrefix}_${name}`,
      description,
      parameters: {
        type: "object",
        properties,
        required
      }
    };
  }
  
  /**
   * Validates that required arguments are present
   * @param args Arguments to validate
   * @param required Array of required argument names
   * @throws McpError if a required argument is missing
   */
  protected validateArgs(args: any, required: string[]): void {
    for (const param of required) {
      if (args[param] === undefined) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Missing required parameter: ${param}`
        );
      }
    }
  }
  
  /**
   * Lists documentation files in a specified path
   * @param path Optional path within the documentation
   * @returns Array of documentation file names
   */
  protected async listDocs(path: string = ""): Promise<string[]> {
    try {
      return await this.docService.listFiles(this.basePath, path);
    } catch (error) {
      this.logService.error(`Failed to list docs at ${path}:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list documentation`
      );
    }
  }
  
  /**
   * Gets the content of a documentation file
   * @param path Path to the file
   * @returns Content of the file
   */
  protected async getDoc(path: string): Promise<string> {
    try {
      return await this.docService.getFileContent(this.basePath, path);
    } catch (error) {
      this.logService.error(`Failed to get doc at ${path}:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get documentation`
      );
    }
  }
  
  /**
   * Searches for a term in the documentation content
   * @param query Search query
   * @returns Array of file paths containing the search term
   */
  protected async searchDocs(query: string): Promise<string[]> {
    try {
      return await this.docService.searchInContent(this.basePath, query);
    } catch (error) {
      this.logService.error(`Failed to search docs for "${query}":`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search documentation`
      );
    }
  }
}