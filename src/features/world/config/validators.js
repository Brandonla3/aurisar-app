import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import worldBuildConfigSchema from "./schemas/world_build_config.schema.json" with { type: "json" };
import promptStackSchema from "./schemas/prompt_stack.schema.json" with { type: "json" };
import tileGameplaySchema from "./schemas/tile_gameplay.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(promptStackSchema);
ajv.addSchema(tileGameplaySchema);

export const validateWorldBuildConfig = ajv.compile(worldBuildConfigSchema);
export const validatePromptStack = ajv.compile(promptStackSchema);
export const validateTileGameplay = ajv.compile(tileGameplaySchema);

export function assertValid(validator, data, label) {
  if (!validator(data)) {
    const msg = ajv.errorsText(validator.errors);
    throw new Error(`Invalid ${label}: ${msg}`);
  }
}
