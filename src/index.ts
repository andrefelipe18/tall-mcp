#!/usr/bin/env node

/**
 * MCP server for Documentation References
 * This server provides tools to:
 * - Browse local documentation files (Filament, Laravel, Livewire)
 * - Search through documentation content
 * - Get detailed information about components and features
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";

// Import handlers from modules
import { DocToolRegistry } from "./tools/registry.ts";
import { FilamentDocTools } from "./tools/filament-docs.ts";
import { LaravelDocTools } from "./tools/laravel-docs.ts";
import { LivewireDocTools } from "./tools/livewire-docs.ts";
import { LogService } from "./services/log-service.ts";
import { DocumentationService } from "./services/documentation-service.ts";
import { BaseConfig } from "./config/base-config.ts";

/**
 * Main server class that initializes and manages the Model Context Protocol server
 */
class DocumentationServer {
  private server: Server;
  private toolRegistry: DocToolRegistry;
  private logService: LogService;
  private docService: DocumentationService;

  /**
   * Initializes the Documentation Server with its services and tools
   */
  constructor() {
    // Initialize core services
    this.logService = new LogService(
      BaseConfig.LOG_ENABLED,
      BaseConfig.LOG_FILE
    );
    this.docService = new DocumentationService();

    // Initialize server
    this.server = new Server(
      {
        name: "documentation-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Setup tool registry and register tool handlers
    this.toolRegistry = new DocToolRegistry(this.docService, this.logService);
    this.registerTools();
    this.setupEventHandlers();
    this.setupToolHandlers();
  }

  /**
   * Register all tool providers in the registry
   */
  private registerTools(): void {
    // Register different document tool providers
    this.toolRegistry.registerProvider(
      new FilamentDocTools(this.docService, this.logService)
    );
    this.toolRegistry.registerProvider(
      new LaravelDocTools(this.docService, this.logService)
    );
    this.toolRegistry.registerProvider(
      new LivewireDocTools(this.docService, this.logService)
    );
  }

  /**
   * Set up event handlers for the server
   */
  private setupEventHandlers(): void {
    // Log errors
    this.server.onerror = (error) =>
      this.logService.error("[MCP Error]", error);

    // Handle shutdown gracefully
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Set up the tool request handlers for the server
   */
  private setupToolHandlers(): void {
    // Handle tool listing requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolRegistry.getAllToolDefinitions(),
    }));

    // Handle tool execution requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        return await this.toolRegistry.executeToolRequest(
          request.params.name,
          request.params.arguments
        );
      } catch (error) {
        this.logService.error(
          `Error executing tool ${request.params.name}:`,
          error
        );

        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  /**
   * Run the server with the specified transport
   */
  async run(): Promise<void> {
    try {
      this.logService.info("Starting Documentation MCP server...");

      // Clean log file if needed
      this.cleanLogFileIfNeeded();

      // Connect with StdioServerTransport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      this.logService.info("Documentation MCP server is running");
    } catch (error) {
      this.logService.error("Error setting up server:", error);
      throw error;
    }
  }

  /**
   * Clean the log file if it gets too large
   */
  private cleanLogFileIfNeeded(): void {
    try {
      const stats = fs.statSync(BaseConfig.LOG_FILE);
      if (stats.size > BaseConfig.MAX_LOG_FILE_SIZE) {
        fs.writeFileSync(BaseConfig.LOG_FILE, ""); // Clear the file
        this.logService.info("Log file was cleared due to size limit");
      }
    } catch (e) {
      // File may not exist yet, ignore
    }
  }
}

// Create and run the server
const server = new DocumentationServer();
server.run().catch((error) => {
  console.error("Server failed to run:", error);
  process.exit(1);
});
