import * as fs from "fs/promises";

/**
 * Server configuration loaded from config/config.json.
 */
export const config = JSON.parse(await fs.readFile("config/config.json", "utf8"));
