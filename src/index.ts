#!/usr/bin/env node

/**
 * MCP server for Filament component references
 * This server provides tools to:
 * - Get detailed information about Filament form fields
 * - Browse local Filament documentation files
 * - Search through Filament documentation
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
import * as path from "path";
import * as os from "os";
import { promisify } from "util";
import { fileURLToPath } from "url";

// Get the equivalent of __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Promisify synchronous fs functions
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

// Log configuration for a separate file instead of stdout/stderr
const LOG_ENABLED = true;
const LOG_FILE = path.join(os.tmpdir(), "filament-mcp-server.log");

const DOCS_BASE_PATH = path.join(__dirname, "..", "data", "filament-docs");

// Logging function that writes to a separate file instead of standard output
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
      // Silence in case of log writing error
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
 * Interface for documentation file
 */
interface DocFile {
  name: string;
  path: string;
  isDirectory: boolean;
  title?: string;
}

/**
 * Interface for documentation package
 */
interface DocPackage {
  name: string;
  path: string;
  description?: string;
}

/**
 * Interface for documentation search result
 */
interface DocSearchResult {
  title: string;
  path: string;
  package: string;
  excerpt: string;
  relevance: number;
}

/**
 * FilamentServer class that handles the component reference functionality
 */
class FilamentServer {
  private server: Server;

  // Cache for local documentation
  private docPackagesCache: DocPackage[] | null = null;
  private docContentCache: Map<string, string> = new Map();

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
          name: "list_filament_packages",
          description:
            "Lists the available packages in the local Filament documentation",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "list_filament_docs",
          description:
            "Lists the available documentation files in a specific package",
          inputSchema: {
            type: "object",
            properties: {
              package: {
                type: "string",
                description:
                  "Name of the package (e.g., 'forms', 'tables', 'panels', etc.)",
              },
              path: {
                type: "string",
                description:
                  "Optional path within the package (e.g., 'fields', 'layout', etc.)",
              },
            },
            required: ["package"],
          },
        },
        {
          name: "get_filament_doc",
          description:
            "Gets the content of a specific file from the Filament documentation",
          inputSchema: {
            type: "object",
            properties: {
              package: {
                type: "string",
                description:
                  "Name of the package (e.g., 'forms', 'tables', 'panels', etc.)",
              },
              path: {
                type: "string",
                description:
                  "Path of the file within the package (e.g., 'fields/text-input', 'installation', etc.)",
              },
            },
            required: ["package", "path"],
          },
        },
        {
          name: "search_filament_docs",
          description:
            "Searches for a term in the entire local Filament documentation",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search term (e.g., 'input', 'validation', 'table', etc.)",
              },
              package: {
                type: "string",
                description:
                  "Optional package to limit the search (e.g., 'forms', 'tables', etc.)",
              },
            },
            required: ["query"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "list_filament_packages":
          return await this.handleListPackages();
        case "list_filament_docs":
          return await this.handleListDocs(request.params.arguments);
        case "get_filament_doc":
          return await this.handleGetDoc(request.params.arguments);
        case "search_filament_docs":
          return await this.handleSearchDocs(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
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
   * Utility to extract title from a Markdown file
   */
  private extractTitleFromMarkdown(content: string): string {
    // Look for level 1 title (# Title)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1].trim();
    }

    // If no level 1 title is found, try to get the file name without extension
    return "Untitled";
  }

  /**
   * Utility to get an excerpt of text containing the query
   */
  private getMarkdownExcerpt(
    content: string,
    query: string,
    length: number = 150
  ): string {
    // Convert to lowercase for case-insensitive search
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Find query index
    const index = lowerContent.indexOf(lowerQuery);
    if (index === -1) {
      // If query not found, return the beginning of the document
      return content.substring(0, Math.min(length, content.length)) + "...";
    }

    // Calculate start and end positions for context
    const startPos = Math.max(0, index - 50);
    const endPos = Math.min(content.length, index + query.length + 100);

    // Add ellipses if excerpt doesn't start at the beginning or end at the end
    const prefix = startPos > 0 ? "..." : "";
    const suffix = endPos < content.length ? "..." : "";

    return prefix + content.substring(startPos, endPos) + suffix;
  }

  /**
   * Cleans file/folder name by removing numeric prefix (e.g., "01-installation" -> "installation")
   */
  private cleanItemName(name: string): string {
    // Remove numeric prefixes like "01-", "02-" etc.
    return name.replace(/^\d+-/, "").replace(".md", "");
  }

  /**
   * Converts file path to readable title
   */
  private pathToTitle(filePath: string): string {
    // Extract file name without extension
    const fileName = path.basename(filePath, ".md");

    // Clean numeric prefix
    const cleanName = this.cleanItemName(fileName);

    // Convert to title with first letter uppercase and dashes to spaces
    return cleanName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Calculates the relevance of a search result
   */
  private calculateRelevance(content: string, query: string): number {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Number of occurrences
    const occurrences = (lowerContent.match(new RegExp(lowerQuery, "g")) || [])
      .length;

    // Check if it's in a title
    const titleMatch = lowerContent.match(
      new RegExp(`^#+\\s+.*${lowerQuery}.*$`, "m")
    );
    const titleBonus = titleMatch ? 10 : 0;

    // Position of the first occurrence (more relevant if it appears early)
    const position = lowerContent.indexOf(lowerQuery);
    const positionScore =
      position === -1 ? 0 : Math.max(0, 10 - Math.floor(position / 100));

    return occurrences + titleBonus + positionScore;
  }

  /**
   * Handle the list_filament_packages tool request
   */
  private async handleListPackages() {
    try {
      // Check cache first
      if (this.docPackagesCache) {
        return this.createSuccessResponse(this.docPackagesCache);
      }

      // Read packages from local directory
      const packagesPath = path.join(DOCS_BASE_PATH, "packages");
      const entries = await readdirAsync(packagesPath);

      // Filter only directories and build package objects
      const packages: DocPackage[] = [];

      for (const entry of entries) {
        const entryPath = path.join(packagesPath, entry);
        const stats = await statAsync(entryPath);

        if (stats.isDirectory()) {
          // Check if it has documentation files
          const docsPath = path.join(entryPath, "docs");
          let hasDocumentation = false;

          try {
            const docsStats = await statAsync(docsPath);
            hasDocumentation = docsStats.isDirectory();
          } catch (e) {
            // Ignore error if docs directory doesn't exist
          }

          if (hasDocumentation) {
            // Try to extract description from a README.md or similar file
            let description = `Documentation for package ${entry}`;

            try {
              // Look for overview or README file
              const overviewPath = path.join(docsPath, "01-overview.md");
              const overviewStats = await statAsync(overviewPath);

              if (overviewStats.isFile()) {
                const content = await readFileAsync(overviewPath, "utf-8");
                const firstParagraph = content.match(/^#.*\n\n(.*?)(\n\n|$)/s);
                if (firstParagraph && firstParagraph[1]) {
                  description = firstParagraph[1].replace(/\n/g, " ").trim();
                }
              }
            } catch (e) {
              // Ignore error if overview file is not found
            }

            packages.push({
              name: entry,
              path: `packages/${entry}`,
              description,
            });
          }
        }
      }

      // Sort packages alphabetically
      packages.sort((a, b) => a.name.localeCompare(b.name));

      // Save to cache
      this.docPackagesCache = packages;

      return this.createSuccessResponse(packages);
    } catch (error) {
      log("Error listing packages:", error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error listing documentation packages: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle the list_filament_docs tool request
   */
  private async handleListDocs(args: any) {
    try {
      if (!args.package || typeof args.package !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "The 'package' parameter is required and must be a string"
        );
      }

      const packageName = args.package.trim();
      const subPath = args.path ? args.path.trim() : "";

      // Build the full path to the directory
      let dirPath = path.join(DOCS_BASE_PATH, "packages", packageName, "docs");

      if (subPath) {
        dirPath = path.join(dirPath, subPath);
      }

      // Check if the directory exists
      try {
        const stats = await statAsync(dirPath);
        if (!stats.isDirectory()) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `The path '${packageName}${
              subPath ? "/" + subPath : ""
            }' is not a valid directory`
          );
        }
      } catch (e) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `The specified package or path does not exist: ${packageName}${
            subPath ? "/" + subPath : ""
          }`
        );
      }

      // Read files and directories
      const entries = await readdirAsync(dirPath);
      const files: DocFile[] = [];

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const stats = await statAsync(entryPath);
        const isDir = stats.isDirectory();

        // Ignore hidden files
        if (entry.startsWith(".")) {
          continue;
        }

        // Build file object
        const docFile: DocFile = {
          name: this.cleanItemName(entry),
          path: subPath ? `${subPath}/${entry}` : entry,
          isDirectory: isDir,
        };

        // For .md files, try to extract title
        if (!isDir && entry.endsWith(".md")) {
          try {
            const content = await readFileAsync(entryPath, "utf-8");
            docFile.title = this.extractTitleFromMarkdown(content);
          } catch (e) {
            // If unable to read, use file name as title
            docFile.title = this.pathToTitle(entry);
          }
        } else if (isDir) {
          // For directories, use clean name as title
          docFile.title = this.pathToTitle(entry);
        }

        files.push(docFile);
      }

      // Sort: directories first, then files
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.path.localeCompare(b.path);
      });

      return this.createSuccessResponse({
        package: packageName,
        path: subPath,
        files: files,
      });
    } catch (error) {
      log("Error listing files:", error);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Error listing documentation files: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle the get_filament_doc tool request
   */
  private async handleGetDoc(args: any) {
    try {
      if (!args.package || typeof args.package !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "The 'package' parameter is required and must be a string"
        );
      }

      if (!args.path || typeof args.path !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "The 'path' parameter is required and must be a string"
        );
      }

      const packageName = args.package.trim();
      let docPath = args.path.trim();

      // Build the full path to the file
      let filePath = path.join(
        DOCS_BASE_PATH,
        "packages",
        packageName,
        "docs",
        docPath
      );

      // Check for .md extension
      if (!filePath.endsWith(".md")) {
        filePath += ".md";
      }

      // Check if the file exists
      try {
        const stats = await statAsync(filePath);
        if (!stats.isFile()) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `The path '${packageName}/${docPath}' is not a valid file`
          );
        }
      } catch (e) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `The requested file does not exist: ${packageName}/${docPath}`
        );
      }

      // Check cache
      const cacheKey = `${packageName}/${docPath}`;
      if (this.docContentCache.has(cacheKey)) {
        const cachedContent = this.docContentCache.get(cacheKey)!;
        const title = this.extractTitleFromMarkdown(cachedContent);

        return this.createSuccessResponse({
          title,
          content: cachedContent,
          package: packageName,
          path: docPath,
        });
      }

      // Read file content
      const content = await readFileAsync(filePath, "utf-8");

      // Extract title
      const title = this.extractTitleFromMarkdown(content);

      // Save to cache
      this.docContentCache.set(cacheKey, content);

      return this.createSuccessResponse({
        title,
        content,
        package: packageName,
        path: docPath,
      });
    } catch (error) {
      log("Error getting file content:", error);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Error getting documentation content: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle the search_filament_docs tool request
   */
  private async handleSearchDocs(args: any) {
    try {
      if (!args.query || typeof args.query !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "The 'query' parameter is required and must be a string"
        );
      }

      const query = args.query.trim().toLowerCase();
      const targetPackage = args.package ? args.package.trim() : null;

      if (query.length < 3) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "The search term must be at least 3 characters long"
        );
      }

      // Load the list of packages if not already cached
      if (!this.docPackagesCache) {
        await this.handleListPackages();
      }

      // Filter only the target package, if specified
      let packagesToSearch = this.docPackagesCache || [];
      if (targetPackage) {
        packagesToSearch = packagesToSearch.filter(
          (pkg) => pkg.name === targetPackage
        );

        if (packagesToSearch.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Package not found: ${targetPackage}`
          );
        }
      }

      const results: DocSearchResult[] = [];

      // Search in all files of each package
      for (const pkg of packagesToSearch) {
        // Build the path to the package's docs folder
        const docsDir = path.join(DOCS_BASE_PATH, "packages", pkg.name, "docs");

        // Recursive function to search in a directory
        const searchInDirectory = async (
          dirPath: string,
          relativePath: string = ""
        ) => {
          const entries = await readdirAsync(dirPath);

          for (const entry of entries) {
            const entryPath = path.join(dirPath, entry);
            const stats = await statAsync(entryPath);

            if (stats.isDirectory()) {
              // Recursion for subdirectories
              const newRelativePath = relativePath
                ? `${relativePath}/${entry}`
                : entry;
              await searchInDirectory(entryPath, newRelativePath);
            } else if (stats.isFile() && entry.endsWith(".md")) {
              // Process Markdown files
              let content: string;

              // Check cache
              const cacheKey = `${pkg.name}/${
                relativePath ? `${relativePath}/` : ""
              }${entry}`;
              if (this.docContentCache.has(cacheKey)) {
                content = this.docContentCache.get(cacheKey)!;
              } else {
                content = await readFileAsync(entryPath, "utf-8");
                this.docContentCache.set(cacheKey, content);
              }

              // Search term in content
              if (content.toLowerCase().includes(query)) {
                const title =
                  this.extractTitleFromMarkdown(content) ||
                  this.pathToTitle(entry);
                const excerpt = this.getMarkdownExcerpt(content, query);
                const relevance = this.calculateRelevance(content, query);

                results.push({
                  title,
                  path: `${
                    relativePath ? `${relativePath}/` : ""
                  }${entry}`.replace(/\.md$/, ""),
                  package: pkg.name,
                  excerpt,
                  relevance,
                });
              }
            }
          }
        };

        await searchInDirectory(docsDir);
      }

      // Sort results by relevance
      results.sort((a, b) => b.relevance - a.relevance);

      return this.createSuccessResponse({
        query,
        results,
        count: results.length,
        package: targetPackage || "all",
      });
    } catch (error) {
      log("Error searching documentation:", error);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Error searching documentation`
      );
    }
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

// Clear the log file if it gets too large
try {
  const stats = fs.statSync(LOG_FILE);
  if (stats.size > 5 * 1024 * 1024) {
    // 5MB
    fs.writeFileSync(LOG_FILE, ""); // Clear the file
  }
} catch (e) {
  // File may not exist yet, ignore
}

// Create and run the server
const server = new FilamentServer();
server.run().catch((error) => {
  log("Server failed to run:", error);
  process.exit(1);
});
