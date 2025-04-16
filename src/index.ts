#!/usr/bin/env node

/**
 * MCP server for Flux UI component references
 * This server provides tools to:
 * - List all available Flux UI components
 * - Get detailed information about specific components
 * - Get usage examples for components
 * - Search for components by keyword
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";
import { Element } from 'domhandler';

/**
 * FilamentServer class that handles all the component reference functionality
 */
class FilamentServer {
  private server: Server;
  private axiosInstance;
  private readonly FILAMENT_DOCS_URL = "https://filamentphp.com/docs/3.x/";

  constructor() {
    this.server = new Server(
      {
        name: "filament-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      timeout: 15000, // Increased timeout slightly
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FluxUiMcpServer/0.1.0)",
      },
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Set up the tool handlers for the server
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Run the server
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Filament MCP server running on stdio");
  }
}

// Create and run the server
const server = new FilamentServer();
server.run().catch((error) => {
  console.error("Server failed to run:", error);
  process.exit(1);
}); 