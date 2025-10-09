// src/utils/pdf-parser.ts
import fs from "fs";
import { pdf } from "pdf-parse";
import { logger } from "../config/mastra";

/**
 * Parse PDF file and return extracted text
 */
export async function parsePdf(filePath: string): Promise<string> {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (err) {
        logger.error(`Error parsing PDF ${filePath}`, err);
        throw err;
    }
}
