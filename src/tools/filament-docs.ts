/**
 * Filament documentation tool provider
 * Implements tools for working with Filament documentation
 */
import { DocumentationService } from "../services/documentation-service.ts";
import { LogService } from "../services/log-service.ts";
import { BaseDocToolProvider } from "./base-doc-tools.ts";
import { ToolDefinition } from "./registry.ts";
import { BaseConfig } from "../config/base-config.ts";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Provider for Filament documentation tools
 */
export class FilamentDocTools extends BaseDocToolProvider {
  protected basePath = BaseConfig.FILAMENT_DOCS_PATH;
  protected typePrefix = "filament";

  constructor(docService: DocumentationService, logService: LogService) {
    super(docService, logService);
  }

  /**
   * Get all tool definitions for Filament documentation
   * @returns Array of tool definitions
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      this.createToolDefinition(
        "packages",
        "Lists the available packages in the local Filament documentation",
        {}
      ),
      this.createToolDefinition(
        "docs",
        "Lists the available documentation files in a specific package",
        {
          package: {
            description:
              "Name of the package (e.g., 'forms', 'tables', 'panels', etc.)",
            type: "string",
          },
          path: {
            description:
              "Optional path within the package (e.g., 'fields', 'layout', etc.)",
            type: "string",
          },
        },
        ["package"]
      ),
      this.createToolDefinition(
        "doc",
        "Gets the content of a specific file from the Filament documentation",
        {
          package: {
            description:
              "Name of the package (e.g., 'forms', 'tables', 'panels', etc.)",
            type: "string",
          },
          path: {
            description:
              "Path of the file within the package (e.g., 'fields/text-input', 'installation', etc.)",
            type: "string",
          },
        },
        ["package", "path"]
      ),
      this.createToolDefinition(
        "search_docs",
        "Searches for a term in the entire local Filament documentation",
        {
          query: {
            description:
              "Search term (e.g., 'input', 'validation', 'table', etc.)",
            type: "string",
          },
          package: {
            description:
              "Optional package to limit the search (e.g., 'forms', 'tables', etc.)",
            type: "string",
          },
        },
        ["query"]
      ),
    ];
  }

  /**
   * Execute a Filament documentation tool
   * @param toolName Name of the tool to execute
   * @param args Arguments for the tool
   * @returns Result of the tool execution
   */
  async executeTool(toolName: string, args: any): Promise<any> {
    const baseName = toolName.replace(/^2d9_filament_/, "");

    switch (baseName) {
      case "packages":
        return this.listPackages();
      case "docs":
        this.validateArgs(args, ["package"]);
        return this.listDocs(args.package, args.path);
      case "doc":
        this.validateArgs(args, ["package", "path"]);
        return this.getFilamentDoc(args.package, args.path);
      case "search_docs":
        this.validateArgs(args, ["query"]);
        return this.searchFilamentDocs(args.query, args.package);
      default:
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unknown Filament tool: ${toolName}`
        );
    }
  }

  /**
   * Lists available Filament packages
   * @returns Array of package names
   */
  protected async listPackages(): Promise<string[]> {
    try {
      const packagesPath = `${this.basePath}/packages`;
      const packages = await this.docService.listFiles(packagesPath);
      return packages;
    } catch (error) {
      this.logService.error("Failed to list Filament packages:", error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list Filament packages`
      );
    }
  }

  /**
   * Lists available documentation files in a package
   * @param packageName Name of the package
   * @param path Optional path within the package
   * @returns Array of file names
   */
  protected async listDocs(
    packageName: string,
    path?: string
  ): Promise<string[]> {
    const basePath = `packages/${packageName}`;
    const docsPath = path ? `${basePath}/${path}` : basePath;

    try {
      return await this.docService.listFiles(this.basePath, docsPath);
    } catch (error) {
      this.logService.error(`Failed to list docs in ${docsPath}:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list documentation in ${packageName}${
          path ? "/" + path : ""
        }`
      );
    }
  }

  /**
   * Gets the content of a specific documentation file
   * @param packageName Name of the package
   * @param path Path of the file within the package
   * @returns Content of the file
   */
  protected async getFilamentDoc(
    packageName: string,
    path: string
  ): Promise<string> {
    const filePath = `packages/${packageName}/${path}`;
    return this.getDoc(filePath);
  }

  /**
   * Searches for a term in the Filament documentation
   * @param query Search term
   * @param packageName Optional package to limit the search
   * @returns Array of file paths containing the search term
   */
  protected async searchFilamentDocs(
    query: string,
    packageName?: string
  ): Promise<string[]> {
    if (packageName) {
      // Search only within the specified package
      const packagePath = `${this.basePath}/packages/${packageName}`;
      return this.docService.searchInContent(packagePath, query);
    } else {
      // Search in all documentation
      return this.searchDocs(query);
    }
  }
}
