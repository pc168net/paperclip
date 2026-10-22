import type { UIAdapterModule } from "../types";
import { parseProcessStdoutLine } from "../process/parse-stdout";
import { SchemaConfigFields, buildSchemaAdapterConfig } from "../schema-config-fields";

/**
 * The custom runner reports its result as ordinary stdout.  Its connection
 * details are collected by the onboarding/new-agent gateway form and carried
 * in `managedAiRouting`; schema fields remain the generic fallback for other
 * adapter-config surfaces.
 */
export const customLocalUIAdapter: UIAdapterModule = {
  type: "custom_local",
  label: "Custom",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildSchemaAdapterConfig,
};
