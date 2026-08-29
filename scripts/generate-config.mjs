import { loadConfig, parseCommonArgs, writeGeneratedConfig } from "./config.mjs";

const args = parseCommonArgs(process.argv.slice(2));
const { config, configPath, isExample } = loadConfig(args.configPath);
const outputPath = writeGeneratedConfig(config);

console.log(`Generated ${outputPath} from ${configPath}${isExample ? " (example configuration)" : ""}.`);
