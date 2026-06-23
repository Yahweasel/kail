import * as fs from "fs/promises";
export const config = JSON.parse(await fs.readFile("config/config.json", "utf8"));
