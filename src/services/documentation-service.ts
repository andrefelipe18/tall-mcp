/**
 * Documentation service for handling file operations
 * Provides methods to read, list, and search documentation files
 */
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { BaseConfig } from "../config/base-config.ts";

// Promisify filesystem operations
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);

/**
 * Service for handling documentation file operations
 * This provides a unified interface for working with documentation files
 */
export class DocumentationService {
  /**
   * Lists all files and directories in a specific path
   * @param basePath Base path to list files from
   * @param subPath Optional sub-path within the base path
   * @returns Array of file and directory names
   */
  async listFiles(basePath: string, subPath: string = ""): Promise<string[]> {
    try {
      const fullPath = path.join(basePath, subPath);
      const entries = await readdir(fullPath);
      return entries;
    } catch (error) {
      throw new Error(
        `Failed to list files in ${basePath}/${subPath}`
      );
    }
  }

  /**
   * Gets the content of a documentation file
   * @param basePath Base path of the documentation
   * @param filePath Path to the file within the documentation
   * @returns The content of the file as a string
   */
  async getFileContent(basePath: string, filePath: string): Promise<string> {
    try {
      const fullPath = path.join(basePath, filePath);

      // Handle both with and without file extension
      let actualPath = fullPath;
      if (!fs.existsSync(actualPath)) {
        actualPath = `${fullPath}.md`;
      }

      if (!fs.existsSync(actualPath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = await readFile(actualPath, "utf-8");
      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}`);
    }
  }

  /**
   * Searches for a term in the content of multiple files
   * @param basePath Base path to search in
   * @param query Search term
   * @returns Array of file paths containing the search term
   */
  async searchInContent(basePath: string, query: string): Promise<string[]> {
    const results = [] as string[];
    const normalizedQuery = query.toLowerCase();

    // Recursive function to search in directories
    const searchInDir = async (dirPath: string) => {
      const entries = await readdir(dirPath);

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          // Recursively search in subdirectories
          await searchInDir(entryPath);
        } else if (stats.isFile() && entry.endsWith(".md")) {
          // Search in markdown files
          try {
            const content = await readFile(entryPath, "utf-8");
            if (content.toLowerCase().includes(normalizedQuery)) {
              // Store relative path for results
              results.push(
                path.relative(basePath, entryPath).replace(/\.md$/, "")
              );
            }
          } catch (error) {
            // Skip files that can't be read
            console.error(`Error reading file ${entryPath}:`, error);
          }
        }
      }
    };

    // Start searching from the base path
    await searchInDir(basePath);
    return results;
  }

  /**
   * Gets a hierarchical listing of documentation package structure
   * @param basePath Base path of the documentation
   * @param packagePath Optional path within the package
   * @returns Object representing the hierarchical structure
   */
  async getPackageStructure(
    basePath: string,
    packagePath: string = ""
  ): Promise<any> {
    try {
      const fullPath = path.join(basePath, packagePath);
      const entries = await readdir(fullPath);

      const result: Record<string, any> = {};

      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry);
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          // Recursively get structure for subdirectories
          result[entry] = await this.getPackageStructure(
            basePath,
            path.join(packagePath, entry)
          );
        } else if (entry.endsWith(".md")) {
          // Add markdown files to the structure
          const name = entry.replace(/\.md$/, "");
          result[name] = "file";
        }
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to get package structure`);
    }
  }
}
