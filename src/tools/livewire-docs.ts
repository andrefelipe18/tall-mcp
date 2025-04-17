/**
 * Livewire documentation tool provider
 * Implements tools for working with Livewire documentation
 */
import { DocumentationService } from "../services/documentation-service.ts";
import { LogService } from "../services/log-service.ts";
import { BaseDocToolProvider } from "./base-doc-tools.ts";
import { ToolDefinition } from "./registry.ts";
import { BaseConfig } from "../config/base-config.ts";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Provider for Livewire documentation tools
 */
export class LivewireDocTools extends BaseDocToolProvider {
  protected basePath = BaseConfig.LIVEWIRE_DOCS_PATH;
  protected typePrefix = "livewire";
  
  constructor(docService: DocumentationService, logService: LogService) {
    super(docService, logService);
  }
  
  /**
   * Get all tool definitions for Livewire documentation
   * @returns Array of tool definitions
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      this.createToolDefinition(
        "docs",
        "Lists the available documentation files in the Livewire documentation",
        {
          path: {
            description: "Optional path within the documentation",
            type: "string"
          }
        }
      ),
      this.createToolDefinition(
        "doc",
        "Gets the content of a specific file from the Livewire documentation",
        {
          path: {
            description: "Path of the file within the documentation (e.g., 'installation', 'components', etc.)",
            type: "string"
          }
        },
        ["path"]
      ),
      this.createToolDefinition(
        "search_docs",
        "Searches for a term in the entire local Livewire documentation",
        {
          query: {
            description: "Search term (e.g., 'component', 'event', 'form', etc.)",
            type: "string"
          }
        },
        ["query"]
      )
    ];
  }
  
  /**
   * Execute a Livewire documentation tool
   * @param toolName Name of the tool to execute
   * @param args Arguments for the tool
   * @returns Result of the tool execution
   */
  async executeTool(toolName: string, args: any): Promise<any> {
    const baseName = toolName.replace(/^2d9_livewire_/, "");
    
    switch (baseName) {
      case "docs":
        return this.listLivewireDocs(args.path);
      case "doc":
        this.validateArgs(args, ["path"]);
        return this.getLivewireDoc(args.path);
      case "search_docs":
        this.validateArgs(args, ["query"]);
        return this.searchLivewireDocs(args.query);
      default:
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unknown Livewire tool: ${toolName}`
        );
    }
  }
  
  /**
   * Lists available Livewire documentation files
   * @param path Optional path within the documentation
   * @returns Array of file names
   */
  private async listLivewireDocs(path?: string): Promise<string[]> {
    try {
      return await this.listDocs(path || "");
    } catch (error) {
      this.logService.error(`Failed to list Livewire docs${path ? ' in ' + path : ''}:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list Livewire documentation${path ? ' in ' + path : ''}`
      );
    }
  }
  
  /**
   * Gets the content of a specific Livewire documentation file
   * @param path Path of the file within the documentation
   * @returns Content of the file
   */
  private async getLivewireDoc(path: string): Promise<string> {
    return this.getDoc(path);
  }
  
  /**
   * Searches for a term in the Livewire documentation
   * @param query Search term
   * @returns Array of file paths containing the search term
   */
  private async searchLivewireDocs(query: string): Promise<string[]> {
    return this.searchDocs(query);
  }
}