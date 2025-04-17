/**
 * Tool registry for all documentation tools
 * Manages tool registration, listing, and execution
 */
import { DocumentationService } from "../services/documentation-service.ts";
import { LogService } from "../services/log-service.ts";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Interface for a tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Interface for a tool provider
 */
export interface ToolProvider {
  /**
   * Gets all tool definitions from this provider
   */
  getToolDefinitions(): ToolDefinition[];
  
  /**
   * Executes a tool by name with the provided arguments
   * @param toolName Name of the tool to execute
   * @param args Arguments for the tool
   */
  executeTool(toolName: string, args: any): Promise<any>;
}

/**
 * Registry for all documentation tools
 * Handles tool registration, listing, and execution dispatch
 */
export class DocToolRegistry {
  private providers: ToolProvider[] = [];
  private docService: DocumentationService;
  private logService: LogService;
  
  constructor(docService: DocumentationService, logService: LogService) {
    this.docService = docService;
    this.logService = logService;
  }
  
  /**
   * Register a new tool provider
   * @param provider The tool provider to register
   */
  registerProvider(provider: ToolProvider): void {
    this.providers.push(provider);
    this.logService.info("Registered tool provider", {
      toolCount: provider.getToolDefinitions().length
    });
  }
  
  /**
   * Get all tool definitions from all registered providers
   * @returns Array of tool definitions
   */
  getAllToolDefinitions(): ToolDefinition[] {
    return this.providers.flatMap(provider => provider.getToolDefinitions());
  }
  
  /**
   * Execute a tool by name with the provided arguments
   * @param toolName Name of the tool to execute
   * @param args Arguments for the tool
   * @returns Result of the tool execution
   * @throws McpError if the tool is not found or execution fails
   */
  async executeToolRequest(toolName: string, args: any): Promise<any> {
    // Find provider that can handle this tool
    for (const provider of this.providers) {
      const toolDefs = provider.getToolDefinitions();
      
      // Check if this provider has a tool with the requested name
      if (toolDefs.some(tool => tool.name === toolName)) {
        try {
          this.logService.info(`Executing tool: ${toolName}`, { args });
          const result = await provider.executeTool(toolName, args);
          this.logService.info(`Tool execution successful: ${toolName}`);
          return result;
        } catch (error) {
          this.logService.error(`Tool execution failed: ${toolName}`, error);
          
          if (error instanceof McpError) {
            throw error;
          }
          
          throw new McpError(
            ErrorCode.InternalError,
            `Tool execution failed`
          );
        }
      }
    }
    
    // If we got here, no provider could handle the tool
    this.logService.error(`Tool not found: ${toolName}`);
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Tool '${toolName}' not found`
    );
  }
}