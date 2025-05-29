import { JSONSchema4 } from "json-schema";

/**
 * Extract namespace from a DMN type string.
 * Example: "DMNType{ https://kie.org/dmn/xyz : Something }" -> "https://kie.org/dmn/xyz"
 */
function extractNamespaceFromDmnType(dmnType: string): string | null {
  const match = dmnType.match(/DMNType{\s*(https?:\/\/[^\s:]+)/);
  return match ? match[1].trim() : null;
}

/**
 * Merge all InputSetDMN__* and OutputSetDMN__* into InputSet and OutputSet properties respectively,
 * grouping each included schema under a namespace-qualified name (e.g., nmspc.DecisionA).
 */
export function mergeDmnSchemas(
  formSchema: JSONSchema4 | undefined,
  namespaceNameMap: Record<string, string>
): JSONSchema4 {
  const originalSchema = formSchema ?? {};
  const definitions = originalSchema.definitions ?? {};

  const inputSet = definitions.InputSet as JSONSchema4 | undefined;
  const outputSet = definitions.OutputSet as JSONSchema4 | undefined;

  const includedInputSets = Object.entries(definitions).filter(([key]) => key.startsWith("InputSetDMN__"));
  const includedOutputSets = Object.entries(definitions).filter(([key]) => key.startsWith("OutputSetDMN__"));

  // Flatten each namespace's properties into full keys like "nmspc.DecisionA"
  function buildFlattenedProps(includedSets: [string, JSONSchema4][]): Record<string, JSONSchema4> {
    const flatProps: Record<string, JSONSchema4> = {};

    includedSets.forEach(([_, schema]) => {
      const dmnType = schema["x-dmn-type"];
      if (typeof dmnType !== "string") return;

      const namespace = extractNamespaceFromDmnType(dmnType);
      const importName = namespace && namespaceNameMap[namespace];
      if (!importName) return;

      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          const fullKey = `${importName}.${key}`;
          flatProps[fullKey] = {
            ...value,
          } as JSONSchema4;
        }
      }
    });

    return flatProps;
  }

  const mergedInputProps = {
    ...(inputSet?.properties ?? {}),
    ...buildFlattenedProps(includedInputSets),
  };

  const mergedOutputProps = {
    ...(outputSet?.properties ?? {}),
    ...buildFlattenedProps(includedOutputSets),
  };
  console.log("mergeinp", mergedInputProps);
  console.log("mergedout", mergedOutputProps);
  return {
    ...originalSchema,
    definitions: {
      ...definitions,
      InputSet: {
        ...inputSet,
        properties: mergedInputProps,
      },
      OutputSet: {
        ...outputSet,
        properties: mergedOutputProps,
      },
    },
  };
}
