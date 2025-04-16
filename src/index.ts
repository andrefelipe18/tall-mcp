#!/usr/bin/env node

/**
 * MCP server for Filament component references
 * This server provides tools to:
 * - Get detailed information about Filament form fields
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
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Configuração de log para um arquivo separado em vez de stdout/stderr
const LOG_ENABLED = true;
const LOG_FILE = path.join(os.tmpdir(), "filament-mcp-server.log");

// Função de log que escreve em arquivo separado e não na saída padrão
function log(...args: any[]) {
  if (LOG_ENABLED) {
    const logMessage = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg) : String(arg)
      )
      .join(" ");

    try {
      fs.appendFileSync(
        LOG_FILE,
        `${new Date().toISOString()}: ${logMessage}\n`
      );
    } catch (e) {
      // Silêncio em caso de erro de escrita no log
    }
  }
}

/**
 * Interface for form field information
 */
interface FieldInfo {
  name: string;
  url: string;
  description: string;
  usage?: string;
  props?: FieldProp[];
  examples?: FieldExample[];
}

/**
 * Interface for field property information
 */
interface FieldProp {
  name: string;
  description: string;
  type?: string;
  default?: string;
  required?: boolean;
}

/**
 * Interface for field example
 */
interface FieldExample {
  title: string;
  code: string;
  description?: string;
}

/**
 * FilamentServer class that handles the component reference functionality
 */
class FilamentServer {
  private server: Server;
  private axiosInstance;
  private fieldCache: Map<string, FieldInfo> = new Map();
  private readonly FILAMENT_DOCS_URL = "https://filamentphp.com/docs/3.x";

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
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FilamentMcpServer/0.1.0)",
      },
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => log("[MCP Error]", error);

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
        {
          name: "get_filament_form_field",
          description:
            "Get detailed information about a specific Filament form field",
          inputSchema: {
            type: "object",
            properties: {
              fieldName: {
                type: "string",
                description:
                  'Name of the Filament form field (e.g., "text-input", "select", "repeater")',
              },
            },
            required: ["fieldName"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "get_filament_form_field":
          return await this.handleGetFormField(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Validates field name from arguments
   */
  private validateFieldName(args: any): string {
    if (!args?.fieldName || typeof args.fieldName !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Field name is required and must be a string"
      );
    }
    return args.fieldName.toLowerCase();
  }

  /**
   * Handles Axios errors consistently
   */
  private handleAxiosError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      log(
        `Axios error during "${context}": ${error.message}`,
        error.response?.status,
        error.config?.url
      );
      if (error.response?.status === 404) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `${context} - Resource not found (404)`
        );
      } else {
        const status = error.response?.status || "N/A";
        const message = error.message;
        throw new McpError(
          ErrorCode.InternalError,
          `Failed during "${context}" operation. Status: ${status}. Error: ${message}`
        );
      }
    }
    log(`Non-Axios error during "${context}":`, error);
    throw error instanceof McpError
      ? error
      : new McpError(
          ErrorCode.InternalError,
          `An unexpected error occurred during "${context}".`
        );
  }

  /**
   * Creates a standardized success response
   */
  private createSuccessResponse(data: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  /**
   * Handle the get_filament_form_field tool request
   */
  private async handleGetFormField(args: any) {
    const fieldName = this.validateFieldName(args);

    try {
      // Check cache first
      if (this.fieldCache.has(fieldName)) {
        const cachedData = this.fieldCache.get(fieldName);
        return this.createSuccessResponse(cachedData);
      }

      // Fetch field details
      const fieldInfo = await this.fetchFieldDetails(fieldName);

      // Save to cache
      this.fieldCache.set(fieldName, fieldInfo);

      return this.createSuccessResponse(fieldInfo);
    } catch (error) {
      log(`Error fetching details for ${fieldName}:`, error);
      if (error instanceof McpError) {
        throw error;
      }
      this.handleAxiosError(error, `fetching details for field "${fieldName}"`);
    }
  }

  /**
   * Fetches field details from the Filament documentation
   */
  private async fetchFieldDetails(fieldName: string): Promise<FieldInfo> {
    const fieldUrl = `${this.FILAMENT_DOCS_URL}/forms/fields/${fieldName}`;
    const response = await this.axiosInstance.get(fieldUrl);
    const $ = cheerio.load(response.data);

    // Extract field information
    const title = $("h1").first().text().trim() || fieldName;
    const description = this.extractDescription($);
    const usage = this.extractUsage($);
    const examples = this.extractExamples($);
    const props = this.extractProps($);

    return {
      name: title,
      url: fieldUrl,
      description,
      usage,
      props: props.length > 0 ? props : undefined,
      examples: examples.length > 0 ? examples : undefined,
    };
  }

  /**
   * Extracts field description from the page
   */
  private extractDescription($: cheerio.CheerioAPI): string {
    // Find the first paragraph after the h1
    const descriptionElement = $("h1").first().nextAll("p").first();

    // If not found, try another selector that might contain the main description
    if (!descriptionElement.length) {
      const mainContent = $("main").first();
      const firstPara = mainContent.find("p").first();
      return firstPara.text().trim();
    }

    return descriptionElement.text().trim();
  }

  /**
   * Extracts basic usage example of the field
   */
  private extractUsage($: cheerio.CheerioAPI): string {
    // Try to find the first code section after a title like "Basic Usage" or similar
    const basicUsageHeading = $("h2, h3")
      .filter((_, el) => {
        const text = $(el).text().toLowerCase();
        return (
          text.includes("basic usage") ||
          text.includes("usage") ||
          text === "basic"
        );
      })
      .first();

    if (basicUsageHeading.length) {
      const codeBlock = basicUsageHeading.nextAll("pre").first();
      if (codeBlock.length) {
        return codeBlock.text().trim();
      }
    }

    // Alternative: just take the first code block on the page
    const firstCodeBlock = $("pre").first();
    return firstCodeBlock.length ? firstCodeBlock.text().trim() : "";
  }

  /**
   * Extracts code examples from the page
   */
  private extractExamples($: cheerio.CheerioAPI): FieldExample[] {
    const examples: FieldExample[] = [];

    // Find all code blocks with their preceding titles
    $("pre").each((_, element) => {
      const codeBlock = $(element);
      const code = codeBlock.text().trim();

      if (code) {
        let title = "Code Example";
        let description: string | undefined = undefined;

        // Try to find the nearest preceding heading (h2, h3, h4)
        const prevHeading = codeBlock.prev("h2, h3, h4");
        if (prevHeading.length) {
          title = prevHeading.text().trim();

          // Try to find a description (paragraph between heading and code)
          const descPara = prevHeading.nextUntil(codeBlock, "p").first();
          if (descPara.length) {
            description = descPara.text().trim();
          }
        }

        examples.push({ title, code, description });
      }
    });

    return examples;
  }

  /**
   * Extracts field properties from the API reference section
   */
  private extractProps($: cheerio.CheerioAPI): FieldProp[] {
    const props: FieldProp[] = [];

    // Find the API reference/Methods/Properties section
    const apiSectionHeadings = $("h2, h3").filter((_, el) => {
      const text = $(el).text().toLowerCase();
      return (
        text.includes("api reference") ||
        text.includes("methods") ||
        text.includes("properties") ||
        text.includes("available methods") ||
        text.includes("configuration")
      );
    });

    if (!apiSectionHeadings.length) {
      return props;
    }

    // For each API/Methods section found
    apiSectionHeadings.each((_, heading) => {
      const headingElement = $(heading);

      // Look for tables after the heading
      const tables = headingElement.nextUntil("h2, h3", "table");
      tables.each((_, table) => {
        const tableElement = $(table);

        // Extract table headers
        const headers: string[] = [];
        tableElement.find("thead th").each((_, th) => {
          headers.push($(th).text().trim().toLowerCase());
        });

        // Determine indices of important columns
        const methodIndex =
          headers.indexOf("method") !== -1
            ? headers.indexOf("method")
            : headers.indexOf("name");
        const descriptionIndex = headers.indexOf("description");
        const typeIndex = headers.indexOf("type");
        const defaultIndex = headers.indexOf("default");

        // Skip this table if essential columns are not found
        if (methodIndex === -1 || descriptionIndex === -1) {
          return;
        }

        // Process each row in the table
        tableElement.find("tbody tr").each((_, tr) => {
          const cells = $(tr).find("td");
          const name = cells.eq(methodIndex).text().trim();
          const description = cells.eq(descriptionIndex).text().trim();

          if (name && description) {
            const prop: FieldProp = {
              name,
              description,
            };

            // Add type if available
            if (typeIndex !== -1) {
              const type = cells.eq(typeIndex).text().trim();
              if (type) prop.type = type;
            }

            // Add default value if available
            if (defaultIndex !== -1) {
              const defaultValue = cells.eq(defaultIndex).text().trim();
              if (defaultValue) prop.default = defaultValue;
            }

            // Check if required based on description
            if (description.toLowerCase().includes("required")) {
              prop.required = true;
            }

            props.push(prop);
          }
        });
      });

      // Also look for lists (dl, dt, dd) that may contain properties
      const lists = headingElement.nextUntil("h2, h3", "dl");
      lists.each((_, list) => {
        const listElement = $(list);

        // Find all terms (dt) and their descriptions (dd)
        listElement.find("dt").each((_, term) => {
          const termElement = $(term);
          const name = termElement.text().trim();
          const descElement = termElement.next("dd");
          const description = descElement.text().trim();

          if (name && description) {
            const prop: FieldProp = {
              name,
              description,
            };

            // Check if required based on description
            if (description.toLowerCase().includes("required")) {
              prop.required = true;
            }

            props.push(prop);
          }
        });
      });
    });

    return props;
  }

  /**
   * Run the server
   */
  async run() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
    } catch (error) {
      log("Error setting up server:", error);
      throw error;
    }
  }
}

// Limpar o arquivo de log se ele ficar muito grande
try {
  const stats = fs.statSync(LOG_FILE);
  if (stats.size > 5 * 1024 * 1024) {
    // 5MB
    fs.writeFileSync(LOG_FILE, ""); // Limpar o arquivo
  }
} catch (e) {
  // Arquivo pode não existir ainda, ignorar
}

// Create and run the server
const server = new FilamentServer();
server.run().catch((error) => {
  log("Server failed to run:", error);
  process.exit(1);
});
