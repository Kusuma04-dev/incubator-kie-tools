/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import * as React from "react";
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useReducer,
  useRef,
} from "react";
import { useWorkspaces, WorkspaceFile } from "@kie-tools-core/workspaces-git-fs/dist/context/WorkspacesContext";
import { DmnRunnerMode, DmnRunnerStatus } from "./DmnRunnerStatus";
import { DmnRunnerDispatchContext, DmnRunnerStateContext } from "./DmnRunnerContext";
import { ExtendedServicesStatus } from "../extendedServices/ExtendedServicesStatus";
import { usePrevious } from "@kie-tools-core/react-hooks/dist/usePrevious";
import { useExtendedServices } from "../extendedServices/ExtendedServicesContext";
import { InputRow } from "@kie-tools/form-dmn";
import {
  DecisionResult,
  DmnEvaluationMessages,
  ExtendedServicesDmnResult,
  ExtendedServicesModelPayload,
} from "@kie-tools/extended-services-api";
import { DmnRunnerAjv } from "@kie-tools/dmn-runner/dist/ajv";
import { useDmnRunnerPersistence } from "../dmnRunnerPersistence/DmnRunnerPersistenceHook";
import { DmnLanguageService, ImportIndex } from "@kie-tools/dmn-language-service";
import { decoder } from "@kie-tools-core/workspaces-git-fs/dist/encoderdecoder/EncoderDecoder";
import { generateUuid } from "../dmnRunnerPersistence/DmnRunnerPersistenceService";
import { useDmnRunnerPersistenceDispatch } from "../dmnRunnerPersistence/DmnRunnerPersistenceDispatchContext";
import cloneDeep from "lodash/cloneDeep";
import { UnitablesInputsConfigs } from "@kie-tools/unitables/dist/UnitablesTypes";
import { useCancelableEffect } from "@kie-tools-core/react-hooks/dist/useCancelableEffect";
import { useOnlineI18n } from "../i18n";
import { Notification } from "@kie-tools-core/notifications/dist/api";
import { useCompanionFsFileSyncedWithWorkspaceFile } from "../companionFs/CompanionFsHooks";
import { Holder } from "@kie-tools-core/react-hooks/dist/Holder";
import { DmnRunnerPersistenceReducerActionType } from "../dmnRunnerPersistence/DmnRunnerPersistenceTypes";
import { CompanionFsServiceBroadcastEvents } from "../companionFs/CompanionFsService";
import {
  DmnRunnerProviderAction,
  DmnRunnerProviderActionType,
  DmnRunnerProviderState,
  DmnRunnerResults,
  DmnRunnerResultsAction,
  DmnRunnerResultsActionType,
} from "./DmnRunnerTypes";
import { DmnRunnerDockToggle } from "./DmnRunnerDockToggle";
import { PanelId, useEditorDockContext } from "../editor/EditorPageDockContextProvider";
import {
  EmptyState,
  EmptyStateBody,
  EmptyStateIcon,
  EmptyStateHeader,
} from "@patternfly/react-core/dist/js/components/EmptyState";
import { Text, TextContent } from "@patternfly/react-core/dist/js/components/Text";
import { ExclamationIcon } from "@patternfly/react-icons/dist/js/icons/exclamation-icon";
import { diff } from "deep-object-diff";
import {
  dereferenceAndCheckForRecursion,
  removeChangedPropertiesAndAdditionalProperties,
  getDefaultValues,
} from "@kie-tools/dmn-runner/dist/jsonSchema";
import { extractDifferencesFromArray } from "@kie-tools/dmn-runner/dist/results";
import { openapiSchemaToJsonSchema } from "@openapi-contrib/openapi-schema-to-json-schema";
import type { JSONSchema4 } from "json-schema";
import { MessageBusClientApi } from "@kie-tools-core/envelope-bus/dist/api";
import { NewDmnEditorEnvelopeApi } from "@kie-tools/dmn-editor-envelope/dist/NewDmnEditorEnvelopeApi";
import { NewDmnEditorTypes } from "@kie-tools/dmn-editor-envelope/dist/NewDmnEditorTypes";
import { ExternalModel, ExternalModelsIndex } from "../../../dmn-editor/dist/DmnEditor";
import { filter, has } from "lodash";

interface Props {
  isEditorReady?: boolean;
  workspaceFile: WorkspaceFile;
  dmnLanguageService?: DmnLanguageService;
}

const initialDmnRunnerProviderStates: DmnRunnerProviderState = {
  isExpanded: false,
  currentInputIndex: 0,
};

function dmnRunnerContextProviderReducer(dmnRunnerProvider: DmnRunnerProviderState, action: DmnRunnerProviderAction) {
  switch (action.type) {
    case DmnRunnerProviderActionType.ADD_ROW:
      action.newState(dmnRunnerProvider);
      return { ...dmnRunnerProvider, currentInputIndex: dmnRunnerProvider.currentInputIndex + 1 };
    case DmnRunnerProviderActionType.TOGGLE_EXPANDED:
      return { ...dmnRunnerProvider, isExpanded: !dmnRunnerProvider.isExpanded };
    default:
      return { ...dmnRunnerProvider, ...action.newState };
  }
}

const initialDmnRunnerResults: DmnRunnerResults = {
  results: [],
  resultsDifference: [[{}]],
};

function dmnRunnerResultsReducer(dmnRunnerResults: DmnRunnerResults, action: DmnRunnerResultsAction) {
  if (action.type === DmnRunnerResultsActionType.CLONE_LAST) {
    return {
      results: [...dmnRunnerResults.results, dmnRunnerResults.results[dmnRunnerResults.results.length - 1]],
      resultsDifference: dmnRunnerResults.resultsDifference,
    };
  } else if (action.type === DmnRunnerResultsActionType.DEFAULT) {
    const differences = extractDifferencesFromArray(action.newResults ?? [], dmnRunnerResults.results);
    return {
      results: action.newResults ? [...action.newResults] : [],
      resultsDifference: [...differences],
    };
  } else {
    throw new Error("Invalid use of dmnRunnerResultDispatcher");
  }
}

/**
 * This transformation is needed for these reasons:
 * ### -1- ###
 * DMN Runner backend return upper case constants: "SUCCEEDED", "FAILED", "SKIPPED"
 * DMN Editor code base uses lower case constants: "succeeded", "failed", "skipped"
 *
 * ### -2- ###
 * DMN Runner backend return evaluationHitIds as Object:
 * {
 *   _F0DC8923-5FC7-4200-8BD1-461D5F3715CF: 1,
 *   _F0DC8923-5FC7-4200-8BD1-461D5F3713AD: 2
 * }
 * DMN Editor code base uses evaluationHitIds as Map<string, number>
 * [
 *   {
 *     key: "_F0DC8923-5FC7-4200-8BD1-461D5F3715CF,
 *     value: 1
 *   },
 *   {
 *     key: "_F0DC8923-5FC7-4200-8BD1-461D5F3713AD",
 *     value: 2
 *   }
 * ]
 *
 * ### -3- ###
 * DMN Runner backend return data spilt into junks corresponding to table row or collection item
 * DMN Editor want to show aggregated data for everything together
 *
 * @param result - DMN Runner backend data
 * @param evaluationResultsByNodeId - transformed data for DMN Editor
 */
function transformExtendedServicesDmnResult(
  result: ExtendedServicesDmnResult,
  evaluationResultsByNodeId: NewDmnEditorTypes.EvaluationResultsByNodeId
) {
  result.decisionResults?.forEach((dr) => {
    const evaluationHitsCountByRuleOrRowId = new Map<string, number>();
    // ### -2- ###
    for (const [key, value] of Object.entries(dr.evaluationHitIds)) {
      evaluationHitsCountByRuleOrRowId.set(`${key}`, value as number);
    }
    // We want to merge evaluation results that belongs to the same Decision
    // So we need to check if the Decision wasn't already partially processed
    if (!evaluationResultsByNodeId.has(dr.decisionId)) {
      evaluationResultsByNodeId.set(dr.decisionId, {
        // ### -1- ###
        evaluationResult: dr.evaluationStatus.toLowerCase() as NewDmnEditorTypes.EvaluationResult,
        evaluationHitsCountByRuleOrRowId: evaluationHitsCountByRuleOrRowId,
      });
    } else {
      const existingEvaluationHitsCount = evaluationResultsByNodeId.get(
        dr.decisionId
      )?.evaluationHitsCountByRuleOrRowId;
      evaluationHitsCountByRuleOrRowId.forEach((value, key) => {
        // ### -3- ###
        if (existingEvaluationHitsCount?.has(key)) {
          existingEvaluationHitsCount.set(key, (existingEvaluationHitsCount?.get(key) ?? 0) + value);
        } else {
          existingEvaluationHitsCount?.set(key, value);
        }
      });
      evaluationResultsByNodeId.set(dr.decisionId, {
        // For a collection input or DMN Runner table mode one Decision may have multiple different evaluation results
        // We keep the worst evaluation result.
        evaluationResult: theWorstEvaluationResult(
          evaluationResultsByNodeId.get(dr.decisionId)?.evaluationResult,
          dr.evaluationStatus.toLowerCase() as NewDmnEditorTypes.EvaluationResult
        ),
        evaluationHitsCountByRuleOrRowId: existingEvaluationHitsCount ?? new Map(),
      });
    }
  });

  return evaluationResultsByNodeId;
}

function theWorstEvaluationResult(a?: NewDmnEditorTypes.EvaluationResult, b?: NewDmnEditorTypes.EvaluationResult) {
  if (a === "failed" || b === "failed") {
    return "failed";
  }
  if (a === "skipped" || b === "skipped") {
    return "skipped";
  }
  return "succeeded";
}

export function DmnRunnerContextProvider(props: PropsWithChildren<Props>) {
  const { i18n } = useOnlineI18n();
  // Calling forceDmnRunnerReRender will cause a update in the dmnRunnerKey
  // dmnRunnerKey should be placed in the Unitables and DmnForm;
  const [dmnRunnerKey, forceDmnRunnerReRender] = useReducer((x) => x + 1, 0);

  // States that can be changed down in the tree with dmnRunnerDispatcher;
  const [{ currentInputIndex, isExpanded }, setDmnRunnerContextProviderState] = useReducer(
    dmnRunnerContextProviderReducer,
    initialDmnRunnerProviderStates
  );

  // States that are in control of the DmnRunnerProvider;
  const [canBeVisualized, setCanBeVisualized] = useState<boolean>(false);
  const [extendedServicesError, setExtendedServicesError] = useState<boolean>(false);
  const [jsonSchema, setJsonSchema] = useState<JSONSchema4 | undefined>(undefined);
  const [{ results, resultsDifference }, setDmnRunnerResults] = useReducer(
    dmnRunnerResultsReducer,
    initialDmnRunnerResults
  );

  // CUSTOM HOOKs
  const extendedServices = useExtendedServices();
  const workspaces = useWorkspaces();
  const {
    dmnRunnerPersistenceService,
    updatePersistenceJsonDebouce,
    dmnRunnerPersistenceJson,
    dmnRunnerPersistenceJsonDispatcher,
  } = useDmnRunnerPersistenceDispatch();
  useDmnRunnerPersistence(props.workspaceFile.workspaceId, props.workspaceFile.relativePath);
  const prevExtendedServicesStatus = usePrevious(extendedServices.status);
  const { panel, setNotifications, addToggleItem, removeToggleItem, onOpenPanel, onTogglePanel } =
    useEditorDockContext();

  const dmnRunnerInputs = useMemo(() => dmnRunnerPersistenceJson.inputs, [dmnRunnerPersistenceJson.inputs]);
  const dmnRunnerMode = useMemo(() => dmnRunnerPersistenceJson.configs.mode, [dmnRunnerPersistenceJson.configs.mode]);
  const dmnRunnerConfigInputs = useMemo(
    () => dmnRunnerPersistenceJson?.configs?.inputs,
    [dmnRunnerPersistenceJson?.configs?.inputs]
  );
  const status = useMemo(() => (isExpanded ? DmnRunnerStatus.AVAILABLE : DmnRunnerStatus.UNAVAILABLE), [isExpanded]);
  const dmnRunnerAjv = useMemo(() => new DmnRunnerAjv().getAjv(), []);
  const [currentResponseMessages, setCurrentResponseMessages] = useState<DmnEvaluationMessages[]>([]);
  const [invalidElementPaths, setInvalidElementPaths] = useState<string[][]>([]);

  const { envelopeServer } = useEditorDockContext();

  useLayoutEffect(() => {
    if (props.isEditorReady) {
      setCanBeVisualized(true);
    } else {
      setCanBeVisualized(false);
    }
  }, [props.isEditorReady]);

  useLayoutEffect(() => {
    setExtendedServicesError(false);
  }, [jsonSchema]);

  // Refer to effect responsible for getting decision results
  const hasJsonSchema = useRef<boolean>(false);
  // Reset JSON Schema;
  useLayoutEffect(() => {
    setJsonSchema(undefined);
    hasJsonSchema.current = false;
  }, [props.workspaceFile.relativePath]);

  useLayoutEffect(() => {
    if (jsonSchema) {
      hasJsonSchema.current = true;
    }
  }, [jsonSchema]);

  // Control the isExpaded state based on the extended services status;
  useLayoutEffect(() => {
    if (props.workspaceFile.extension !== "dmn") {
      return;
    }

    if (
      extendedServices.status === ExtendedServicesStatus.STOPPED ||
      extendedServices.status === ExtendedServicesStatus.NOT_RUNNING
    ) {
      setDmnRunnerContextProviderState({ type: DmnRunnerProviderActionType.DEFAULT, newState: { isExpanded: false } });
    }
  }, [prevExtendedServicesStatus, extendedServices.status, props.workspaceFile.extension]);

  const processJsonSchema = (jsonSchema: JSONSchema4, importIndex: ImportIndex): JSONSchema4 => {
    if (!jsonSchema.definitions) return jsonSchema;
    console.log("importindex", importIndex);
    // console.log("importindex", JSON.parse(JSON.stringify(importIndex)));
    console.log("jsonSchema", jsonSchema);
    const modifiedSchema = cloneDeep(jsonSchema);
    const inputSet = modifiedSchema.definitions!.InputSet;
    if (!inputSet?.properties) return modifiedSchema;

    const includedContainer: JSONSchema4 = {
      type: "object",
      properties: {},
    };

    let currentContainer = includedContainer;

    const importedModelsMap = new Map<string, any>();
    // const importModels = Array.from(importIndex.models.values()).filter((model) => model.definitions?.import);
    const importModels = Array.from(importIndex.models.values());

    const modelElementsMap = new Map<string, Map<string, any>>();

    const decisionInputMap = new Map<string, Set<string>>();

    // First, populate importedModelsMap and modelElementsMap
    for (const model of importModels) {
      const imports = Array.isArray(model.definitions.import) ? model.definitions.import : [model.definitions.import];

      for (const imp of imports) {
        if (imp?.["@_namespace"]) {
          importedModelsMap.set(imp["@_namespace"], model);
        }
      }

      const drgElements = model.definitions?.drgElement || [];
      const elementsMap = new Map<string, any>();
      drgElements.forEach((element: any) => {
        const id = element["@_id"];
        elementsMap.set(id, element);
      });
      modelElementsMap.set(model.definitions?.["@_namespace"] || "", elementsMap);
    }

    console.log("mappedInputs", modelElementsMap);

    const getDecisionInputs = (decisionId: string, modelNamespace: string): Set<string> => {
      const cacheKey = `${modelNamespace}#${decisionId}`;
      if (decisionInputMap.has(cacheKey)) {
        return decisionInputMap.get(cacheKey)!;
      }

      const inputs = new Set<string>();
      decisionInputMap.set(cacheKey, inputs);

      const elementsMap = modelElementsMap.get(modelNamespace);
      if (!elementsMap) return inputs;

      const decision = elementsMap.get(decisionId);
      if (!decision || decision["__$$element"] !== "decision") return inputs;

      const requirements = decision.informationRequirement || [];
      for (const req of requirements) {
        if (req.requiredInput) {
          // Direct input requirement
          const inputHref = req.requiredInput["@_href"];
          const inputId = inputHref.startsWith("#") ? inputHref.substring(1) : inputHref;
          inputs.add(inputId);
        } else if (req.requiredDecision) {
          // Decision dependency - could be local or from another model
          const depHref = req.requiredDecision["@_href"];
          let depModelNamespace = modelNamespace;
          let depId = depHref;

          if (depHref.includes("#")) {
            const [nsPart, idPart] = depHref.split("#");
            if (nsPart.startsWith("http") || nsPart.startsWith("https")) {
              // Cross-model reference
              depModelNamespace = nsPart;
              depId = idPart;
            } else {
              // Local reference with #
              depId = idPart;
            }
          }

          // Find the model that contains this decision
          const depModel = importedModelsMap.get(depModelNamespace);
          if (depModel) {
            console.log("depModel", depModel);
            // Recursively get all inputs for this dependent decision
            const depInputs = getDecisionInputs(depId, depModelNamespace);
            depInputs.forEach((inputId) => inputs.add(inputId));
          }
        }
      }

      return inputs;
    };

    // Build the complete dependency graph for all decisions in all models
    for (const [modelNamespace, elementsMap] of modelElementsMap) {
      for (const [id, element] of elementsMap) {
        if (element["__$$element"] === "decision") {
          getDecisionInputs(id, modelNamespace);
          const x = getDecisionInputs(id, modelNamespace);
          // console.log(x);
        }
      }
      console.log("Decesion Map", decisionInputMap);
    }

    const requiredDecision: any[] = [];
    const decisions = new Set<string>();

    const filterRequiredDecisionInputs = (requiredNameSpace?: string) => {
      if (!requiredNameSpace) {
        return;
      }
      const elementsMap = modelElementsMap.get(requiredNameSpace);
      if (elementsMap) {
        for (const [id, element] of elementsMap) {
          // console.log("element", element, id);
          const requirements = element.informationRequirement || [];
          if (requirements.length === 0) {
            continue;
          }
          for (const req of requirements) {
            if (req.requiredInput) {
              // const inputHref = req.requiredInput["@_href"];
              // const inputId = inputHref.startsWith("#") ? inputHref.substring(1) : inputHref;
              // decisionInputMap.set(`${requiredNameSpace}#${id}`, new Set([inputId]));
            } else if (req.requiredDecision) {
              const depHref = req.requiredDecision["@_href"];

              if (decisionInputMap.has(depHref)) {
                requiredDecision.push(depHref);
                decisions.add(depHref);
              }

              let hasfurtherDependencies = false;

              if (depHref.includes("#")) {
                const [nsPart, idPart] = depHref.split("#");
                if (nsPart.startsWith("http") || nsPart.startsWith("https")) {
                  // Cross-model reference
                  hasfurtherDependencies = true;
                }
                if (nsPart) {
                  filterRequiredDecisionInputs(nsPart);
                }
              }
            }
          }
        }
        const s = new Set(requiredDecision);
        // console.log("requiredDecision", s);
        // console.log("requiredDecision", decisions);
      }
      // console.log("elementsMap", elementsMap, requiredNameSpace);
    };

    for (const model of importModels) {
      const imports = Array.isArray(model.definitions.import) ? model.definitions.import : [model.definitions.import];

      for (const imp of imports) {
        const importName = imp?.["@_name"];
        const namespace = imp?.["@_namespace"];
        if (!namespace) continue;

        let firstElement;
        for (const item of importIndex.models) {
          firstElement = item;
          break; // Exit after the first element
        }
        // console.log(firstElement); // Output: 10
        firstElement && firstElement[1] && filterRequiredDecisionInputs(firstElement[1].definitions?.["@_namespace"]);

        const dmnDef = Object.values(modifiedSchema.definitions!).find((def) =>
          def?.["x-dmn-type"]?.includes(namespace)
        ) as JSONSchema4 | undefined;

        if (!dmnDef || !dmnDef.properties) continue;

        const filteredProperties: Record<string, any> = {};

        const InputIDS: string[] = [];
        const InputNAMES: string[] = [];

        for (const [cacheKey, inputIds] of decisionInputMap) {
          if (requiredDecision.includes(cacheKey)) {
            const [ns, _] = cacheKey.split("#");
            const elementsMap = modelElementsMap.get(ns);
            if (!elementsMap) continue;
            for (const [id, element] of elementsMap) {
              if (id === _) {
                console.log("element", element, "id", id, "cacheKey", cacheKey, "inputIds", inputIds);
                const requirements = element.informationRequirement || [];
                if (requirements.length === 0) {
                  continue;
                }

                const inputs = requirements.filter((req: { requiredInput: any }) => req.requiredInput);

                inputs.map((x: { requiredInput: { [x: string]: string } }) => {
                  InputIDS.push(x.requiredInput["@_href"].split("#")[1]);
                });

                // console.log("inputs", inputs, "element", element, "id", id, "cacheKey", cacheKey, "inputIds", inputIds);
              }
              // console.log("inputIds", inputIds);

              // if (ns !== namespace) {
              //   continue;
              // }
              // console.log("cacheKey", cacheKey, "inputIds", inputIds);
              // for (const inputId of inputIds) {
              //   if (dmnDef.properties[inputId]) {
              //     console.log("inputId", inputId, "dmnDef.properties[inputId]", dmnDef.properties[inputId]);
              //   }
              // }
            }
            // console.log(elementsMap, "elementsMap", ns, cacheKey, InputIDS, _);
          }
        }

        for (const [cacheKey, inputIds] of decisionInputMap) {
          if (requiredDecision.includes(cacheKey)) {
            const [ns, _] = cacheKey.split("#");
            const elementsMap = modelElementsMap.get(ns);
            if (!elementsMap) continue;
            for (const [id, element] of elementsMap) {
              if (InputIDS.includes(id)) {
                InputNAMES.push(element["@_name"]);

                // console.log("inputs", inputs, "element", element, "id", id, "cacheKey", cacheKey, "inputIds", inputIds);
              }
            }
            // console.log(elementsMap, "elementsMap", ns, cacheKey, InputIDS, _);
          }
        }

        console.log("InputIDS", InputIDS);
        console.log("InputNAMES", InputNAMES);

        for (const [propKey, propValue] of Object.entries(dmnDef.properties)) {
          // console.log("propKey", propKey, "propValue", propValue);
          let isRequired = false;

          for (const [cacheKey, inputIds] of decisionInputMap) {
            const [ns, _] = cacheKey.split("#");
            // if (ns === namespace) {
            //     isRequired = true;
            //     break;
            // }

            console.log(requiredDecision.includes(cacheKey));
            if (requiredDecision.includes(cacheKey)) {
              isRequired = true;
              break;
            }
            // if (ns === namespace && imports[0] && namespace == imports[0]["@_namespace"]) {
            //   isRequired = true;
            //   break;
            // }
          }

          if (isRequired && InputNAMES.includes(propKey)) {
            console.log("key", propKey);
            filteredProperties[propKey] = propValue;
            console.log("value", filteredProperties[propKey]);
          }
        }

        if (importName) {
          const prefixedName = importName;

          currentContainer.properties![prefixedName] = {
            type: "object",
            properties: filteredProperties,
            required: dmnDef.required,
          };

          currentContainer = currentContainer.properties![prefixedName];
        } else {
          Object.assign(currentContainer.properties!, filteredProperties);
        }
      }
    }

    if (Object.keys(includedContainer.properties!).length > 0) {
      inputSet.properties["Included Model Inputs"] = includedContainer;
    }
    console.log("schema", modifiedSchema);

    return modifiedSchema;
  };

  const extendedServicesModelPayload = useCallback<(formInputs?: InputRow) => Promise<ExtendedServicesModelPayload>>(
    async (formInputs) => {
      const fileContent = await workspaces.getFileContent({
        workspaceId: props.workspaceFile.workspaceId,
        relativePath: props.workspaceFile.relativePath,
      });

      const decodedFileContent = decoder.decode(fileContent);
      const importIndex = await props.dmnLanguageService?.buildImportIndex([
        {
          content: decodedFileContent,
          normalizedPosixPathRelativeToTheWorkspaceRoot: props.workspaceFile.relativePath,
        },
      ]);
      console.log("importIndex", importIndex);
      console.log("formInputs", formInputs);
      const { ["Included Model Inputs"]: includedModelInputs, ...rest } = formInputs || {};
      const context = {
        ...rest,
        ...(includedModelInputs
          ? Object.fromEntries(
              Object.entries(includedModelInputs).map(([key, val]) => {
                const prefix = "Included Import Name ";
                const cleanKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
                return [cleanKey, val];
              })
            )
          : {}),
      };

      return {
        context: context,
        mainURI: props.workspaceFile.relativePath,
        resources: [...(importIndex?.models.entries() ?? [])].map(
          ([normalizedPosixPathRelativeToTheWorkspaceRoot, model]) => ({
            content: model.xml,
            URI: normalizedPosixPathRelativeToTheWorkspaceRoot,
          })
        ),
      };
    },
    [props.dmnLanguageService, props.workspaceFile.relativePath, props.workspaceFile.workspaceId, workspaces]
  );

  const findDecisionIdBySourceId = useCallback(
    (sourceId: string) => {
      if (!Array.isArray(invalidElementPaths)) return "";
      for (const path of invalidElementPaths) {
        if (path.includes(sourceId)) {
          return path[0];
        }
      }
      return "";
    },
    [invalidElementPaths]
  );

  // Responsible for getting decision results
  useCancelableEffect(
    useCallback(
      ({ canceled }) => {
        if (props.workspaceFile.extension !== "dmn" || extendedServices.status !== ExtendedServicesStatus.RUNNING) {
          return;
        }

        Promise.all(
          dmnRunnerInputs.map((dmnRunnerInput) => {
            // extendedServicesModelPayload triggers a re-run in this effect before the jsonSchema values is updated
            // in the useLayoutEffect, making this effect to be triggered with the previous file.
            const input = hasJsonSchema.current === false ? {} : dmnRunnerInput;
            return extendedServicesModelPayload(input);
          })
        )
          .then((payloads) =>
            Promise.all(
              payloads.map((payload) => {
                if (canceled.get() || payload === undefined) {
                  return;
                }
                return extendedServices.client.result(payload);
              })
            )
          )
          .then((results) => {
            if (canceled.get()) {
              return;
            }
            if (dmnRunnerMode === DmnRunnerMode.TABLE) {
              const messagesWithRowNumbers = results.flatMap((result, rowIndex) =>
                (result?.messages || []).map((message) => ({
                  ...message,
                  message: `Row ${rowIndex + 1} : ${message.messageType}: ${message.message}`,
                }))
              );
              setCurrentResponseMessages(messagesWithRowNumbers);
            } else {
              const messagesWithTypes =
                results[currentInputIndex]?.messages?.map((message) => ({
                  ...message,
                  message: `${message.messageType}: ${message.message}`,
                })) || [];
              setCurrentResponseMessages(messagesWithTypes);
            }

            const invalidElements: string[][] = [];
            const runnerResults: Array<DecisionResult[] | undefined> = [];
            for (const result of results) {
              if (Object.hasOwnProperty.call(result, "details") && Object.hasOwnProperty.call(result, "stack")) {
                setExtendedServicesError(true);
                break;
              }
              if (result) {
                invalidElements.push(...result.invalidElementPaths);
                runnerResults.push(result.decisionResults);
              }
            }
            setDmnRunnerResults({ type: DmnRunnerResultsActionType.DEFAULT, newResults: runnerResults });
            setInvalidElementPaths(invalidElements);

            const evaluationResultsByNodeId: NewDmnEditorTypes.EvaluationResultsByNodeId = new Map();
            if (dmnRunnerMode === DmnRunnerMode.FORM && results[currentInputIndex]) {
              transformExtendedServicesDmnResult(results[currentInputIndex], evaluationResultsByNodeId);
            } else {
              for (const result of results) {
                if (Object.hasOwnProperty.call(result, "details") && Object.hasOwnProperty.call(result, "stack")) {
                  break;
                }
                if (result) {
                  transformExtendedServicesDmnResult(result, evaluationResultsByNodeId);
                }
              }
            }
            const newDmnEditorEnvelopeApi = envelopeServer?.envelopeApi as MessageBusClientApi<NewDmnEditorEnvelopeApi>;
            newDmnEditorEnvelopeApi.notifications.newDmnEditor_showDmnEvaluationResults.send(evaluationResultsByNodeId);
          })
          .catch((err) => {
            console.log(err);
            setDmnRunnerResults({ type: DmnRunnerResultsActionType.DEFAULT });
          });
      },
      [
        props.workspaceFile.extension,
        extendedServices.status,
        extendedServices.client,
        dmnRunnerInputs,
        extendedServicesModelPayload,
        dmnRunnerMode,
        currentInputIndex,
        envelopeServer?.envelopeApi,
      ]
    )
  );

  // EditorDock drawer controller;
  useLayoutEffect(() => {
    if (dmnRunnerMode === DmnRunnerMode.TABLE) {
      addToggleItem(PanelId.DMN_RUNNER_TABLE, <DmnRunnerDockToggle key="dmn-runner-toggle-item" />);

      return () => {
        removeToggleItem(PanelId.DMN_RUNNER_TABLE);
      };
    }
  }, [addToggleItem, removeToggleItem, dmnRunnerMode]);

  useLayoutEffect(() => {
    if (dmnRunnerMode === DmnRunnerMode.FORM && panel === PanelId.DMN_RUNNER_TABLE) {
      onOpenPanel(PanelId.NONE);
    }
  }, [dmnRunnerMode, panel, onOpenPanel, onTogglePanel, isExpanded]);

  // BEGIN -
  // At the first render it should open the DMN Runner Table if runner is in Table mode and isExpanded = true
  // This effect will run everytime the file name is changed;
  const runEffect = useRef(true);
  useLayoutEffect(() => {
    if (panel !== PanelId.DMN_RUNNER_TABLE) {
      runEffect.current = true;
    }

    // it should exec only when the relativePath changes;
    // eslint-disable-next-line
  }, [props.workspaceFile.relativePath]);

  useLayoutEffect(() => {
    if (runEffect.current) {
      if (panel !== PanelId.DMN_RUNNER_TABLE && dmnRunnerMode === DmnRunnerMode.TABLE && isExpanded) {
        onTogglePanel(PanelId.DMN_RUNNER_TABLE);
      }
      runEffect.current = false;
    }
  }, [dmnRunnerMode, isExpanded, onTogglePanel, panel]);
  // END
  const decisionNameByDecisionId = useMemo(
    () =>
      results.reduce((decisionMap, decisionResults) => {
        if (decisionResults) {
          decisionResults.forEach((decisionResult) => {
            decisionMap.set(decisionResult.decisionId, decisionResult.decisionName);
          });
        }
        return decisionMap;
      }, new Map<string, string>()),
    [results]
  );

  // Set evaluation tab on Problems panel;
  useEffect(() => {
    if (props.workspaceFile.extension !== "dmn" || extendedServices.status !== ExtendedServicesStatus.RUNNING) {
      return;
    }

    const messagesBySourceId = currentResponseMessages.reduce((acc, message) => {
      const messageEntry = acc.get(message.sourceId);
      if (!messageEntry) {
        acc.set(message.sourceId, [message]);
      } else {
        acc.set(message.sourceId, [...messageEntry, message]);
      }
      return acc;
    }, new Map<string, DmnEvaluationMessages[]>());

    const notifications: Notification[] = [...messagesBySourceId.entries()].flatMap(([sourceId, messages]) => {
      const decisionId = findDecisionIdBySourceId(sourceId);
      const path = decisionNameByDecisionId?.get(decisionId) ?? "";
      return messages.map((message: any) => ({
        type: "PROBLEM",
        normalizedPosixPathRelativeToTheWorkspaceRoot: path,
        severity: message.severity,
        message: `${message.message}`,
      }));
    });

    setNotifications(i18n.terms.evaluation, "", notifications as any);
  }, [
    setNotifications,
    i18n.terms.evaluation,
    results,
    currentInputIndex,
    props.workspaceFile.extension,
    extendedServices.status,
    currentResponseMessages,
    decisionNameByDecisionId,
    findDecisionIdBySourceId,
  ]);

  const setDmnRunnerPersistenceJson = useCallback(
    (args: {
      newInputsRow?: ((previousInputs: Array<InputRow>) => Array<InputRow>) | Array<InputRow>;
      newMode?: DmnRunnerMode;
      newConfigInputs?:
        | ((previousConfigInputs: UnitablesInputsConfigs) => UnitablesInputsConfigs)
        | UnitablesInputsConfigs;
      shouldUpdateFs?: boolean;
      cancellationToken?: Holder<boolean>;
    }) => {
      dmnRunnerPersistenceJsonDispatcher({
        updatePersistenceJsonDebouce,
        workspaceFileRelativePath: props.workspaceFile.relativePath,
        workspaceId: props.workspaceFile.workspaceId,
        type: DmnRunnerPersistenceReducerActionType.PREVIOUS,
        newPersistenceJson: (previousDmnRunnerPersistenceJson) => {
          const newDmnRunnerPersistenceJson = cloneDeep(previousDmnRunnerPersistenceJson);
          if (args.newInputsRow) {
            const updatedInputs = Array.isArray(args.newInputsRow)
              ? args.newInputsRow
              : args.newInputsRow(previousDmnRunnerPersistenceJson.inputs);

            const finalInputs: InputRow[] = [];

            updatedInputs.forEach((input) => {
              const finalInput: InputRow = {};

              // Merge all top-level properties from the input object (except "included model inputs")
              Object.keys(input).forEach((key) => {
                if (key !== "included model inputs") {
                  finalInput[key] = input[key]; // Regular input
                }
              });

              // If there are model-specific inputs (like "included model inputs"), merge them as well
              if (input["included model inputs"]) {
                Object.keys(input["included model inputs"]).forEach((modelKey) => {
                  finalInput[modelKey] = input["included model inputs"][modelKey];
                });
              }

              // Push the finalInput into the array
              finalInputs.push(finalInput);
            });

            // Replace or update the inputs array
            newDmnRunnerPersistenceJson.inputs = finalInputs;
          }

          if (args.newMode) {
            newDmnRunnerPersistenceJson.configs.mode = args.newMode;
          }

          if (typeof args.newConfigInputs === "function") {
            newDmnRunnerPersistenceJson.configs.inputs = args.newConfigInputs(
              previousDmnRunnerPersistenceJson.configs.inputs
            );
          } else if (args.newConfigInputs) {
            newDmnRunnerPersistenceJson.configs.inputs = args.newConfigInputs;
          }
          return newDmnRunnerPersistenceJson;
        },
        shouldUpdateFs: args.shouldUpdateFs !== undefined ? args.shouldUpdateFs : true,
        cancellationToken: args.cancellationToken ?? new Holder(false),
      });
    },
    [
      updatePersistenceJsonDebouce,
      dmnRunnerPersistenceJsonDispatcher,
      props.workspaceFile.relativePath,
      props.workspaceFile.workspaceId,
    ]
  );

  const setDmnRunnerInputs = useCallback(
    (newInputsRow: ((previousInputs: Array<InputRow>) => Array<InputRow>) | Array<InputRow>) => {
      setDmnRunnerPersistenceJson({ newInputsRow });
    },
    [setDmnRunnerPersistenceJson]
  );

  const setDmnRunnerMode = useCallback(
    (newMode: DmnRunnerMode) => {
      setDmnRunnerPersistenceJson({ newMode });
    },
    [setDmnRunnerPersistenceJson]
  );

  const setDmnRunnerConfigInputs = useCallback(
    (
      newConfigInputs: (previousConfigInputs: UnitablesInputsConfigs) => UnitablesInputsConfigs | UnitablesInputsConfigs
    ) => {
      setDmnRunnerPersistenceJson({ newConfigInputs });
    },
    [setDmnRunnerPersistenceJson]
  );

  useLayoutEffect(() => {
    // Reset inputs and configs when the jsonSchema changes
    setDmnRunnerPersistenceJson({
      newInputsRow: [],
      newConfigInputs: {},
      shouldUpdateFs: false,
      cancellationToken: new Holder(false),
    });
  }, [jsonSchema, setDmnRunnerPersistenceJson]);

  // The refreshCallback is called after a CompanionFS event;
  // When another TAB updates the FS, this callback will sync up;
  useCompanionFsFileSyncedWithWorkspaceFile(
    dmnRunnerPersistenceService.companionFsService,
    props.workspaceFile.workspaceId,
    props.workspaceFile.relativePath,
    useCallback(
      async (cancellationToken: Holder<boolean>, workspaceFileEvent: CompanionFsServiceBroadcastEvents | undefined) => {
        if (!jsonSchema || !workspaceFileEvent) {
          return;
        }

        // CFSF_ADD is triggered on file creation, file rename, persistence deletion or upload.
        if (workspaceFileEvent.type === "CFSF_ADD") {
          const dmnRunnerPersistenceJson = dmnRunnerPersistenceService.parseDmnRunnerPersistenceJson(
            workspaceFileEvent.content
          );

          // Remove incompatible values and add default values;
          try {
            const validate = dmnRunnerAjv.compile(jsonSchema);
            dmnRunnerPersistenceJson.inputs.forEach((input) => {
              // save id;
              const id = input.id;
              removeChangedPropertiesAndAdditionalProperties(validate, input);
              input.id = id;
            });
          } catch (error) {
            console.debug("DMN RUNNER AJV:", error);
          }

          setDmnRunnerPersistenceJson({
            newConfigInputs: cloneDeep(dmnRunnerPersistenceJson.configs.inputs),
            newInputsRow: cloneDeep(dmnRunnerPersistenceJson.inputs).map((dmnRunnerInput) => ({
              ...getDefaultValues(jsonSchema),
              ...dmnRunnerInput,
            })),
            shouldUpdateFs: false,
            cancellationToken,
          });
          forceDmnRunnerReRender();
          return;
        }

        // CFSF_UPDATE will be called on every runner update;
        // CFSF_DELETE will be called when FS is deleted;
        if (workspaceFileEvent.type === "CFSF_UPDATE" || workspaceFileEvent.type === "CFSF_DELETE") {
          const dmnRunnerPersistenceJson = dmnRunnerPersistenceService.parseDmnRunnerPersistenceJson(
            workspaceFileEvent.content
          );

          if (!dmnRunnerPersistenceJson) {
            return;
          }

          setDmnRunnerPersistenceJson({
            newConfigInputs: dmnRunnerPersistenceJson.configs.inputs,
            newInputsRow: dmnRunnerPersistenceJson.inputs,
            shouldUpdateFs: false,
            cancellationToken,
          });
          return;
        }

        if (workspaceFileEvent.type === "CFSF_MOVE" || workspaceFileEvent.type === "CFSF_RENAME") {
          // ignore;
        }
        return;
      },
      [dmnRunnerAjv, dmnRunnerPersistenceService, jsonSchema, setDmnRunnerPersistenceJson]
    )
  );

  // Responsible to set the JSON schema based on the DMN model;
  useCancelableEffect(
    useCallback(
      ({ canceled }) => {
        if (props.workspaceFile.extension !== "dmn" || extendedServices.status !== ExtendedServicesStatus.RUNNING) {
          setDmnRunnerContextProviderState({
            type: DmnRunnerProviderActionType.DEFAULT,
            newState: { isExpanded: false },
          });
          return;
        }

        extendedServicesModelPayload()
          .then((modelPayload) => {
            if (canceled.get() || modelPayload === undefined) {
              return;
            }
            extendedServices.client.formSchema(modelPayload).then((formSchema) => {
              if (canceled.get()) {
                return;
              }

              dereferenceAndCheckForRecursion(formSchema, canceled)
                .then(async (dereferencedOpenApiSchema) => {
                  if (canceled.get() || !dereferencedOpenApiSchema) {
                    return;
                  }

                  const jsonSchema = openapiSchemaToJsonSchema(dereferencedOpenApiSchema, {
                    definitionKeywords: ["definitions"],
                  });
                  const fileContent = await workspaces.getFileContent({
                    workspaceId: props.workspaceFile.workspaceId,
                    relativePath: props.workspaceFile.relativePath,
                  });
                  const decodedFileContent = decoder.decode(fileContent);
                  const importIndex = await props.dmnLanguageService?.buildImportIndex([
                    {
                      content: decodedFileContent,
                      normalizedPosixPathRelativeToTheWorkspaceRoot: props.workspaceFile.relativePath,
                    },
                  ]);
                  const processedSchema = importIndex ? processJsonSchema(jsonSchema, importIndex) : jsonSchema;

                  console.log("jsonSchema", jsonSchema);
                  setJsonSchema((previousJsonSchema) => {
                    // Early bailout in the DMN first render;
                    // This prevents to set the inputs from the previous DMN
                    if (!previousJsonSchema) {
                      return processedSchema;
                    }

                    const validateInputs = dmnRunnerAjv.compile(processedSchema);

                    // Add default values and delete changed data types;
                    setDmnRunnerPersistenceJson({
                      newConfigInputs: (previousConfigInputs) => {
                        const newConfigInputs = cloneDeep(previousConfigInputs);
                        removeChangedPropertiesAndAdditionalProperties(validateInputs, newConfigInputs);
                        return newConfigInputs;
                      },
                      newInputsRow: (previousInputs) => {
                        return cloneDeep(previousInputs).map((input) => {
                          const id = input.id;
                          removeChangedPropertiesAndAdditionalProperties(validateInputs, input);
                          input.id = id;
                          return { ...getDefaultValues(processedSchema), ...input };
                        });
                      },
                      cancellationToken: canceled,
                    });

                    // This should be done to remove any previous errors or to add new errors
                    if (Object.keys(diff(previousJsonSchema, processedSchema)).length > 0) {
                      forceDmnRunnerReRender();
                    }
                    return processedSchema;
                  });
                })
                .catch((err) => {
                  if (canceled.get()) {
                    return;
                  }
                  console.log(err);
                  setJsonSchema(undefined);
                });
            });
          })
          .catch((err) => {
            console.error(err);
            setExtendedServicesError(true);
          });
      },
      [
        dmnRunnerAjv,
        extendedServices.client,
        extendedServices.status,
        extendedServicesModelPayload,
        props.dmnLanguageService,
        props.workspaceFile.extension,
        props.workspaceFile.relativePath,
        props.workspaceFile.workspaceId,
        setDmnRunnerPersistenceJson,
        workspaces,
      ]
    )
  );

  const onRowAdded = useCallback(
    (args: { beforeIndex: number }) => {
      setDmnRunnerInputs((previousInputs) => {
        const newInputs = cloneDeep(previousInputs);
        const defaultValues = getDefaultValues(jsonSchema ?? {});
        newInputs.splice(args.beforeIndex, 0, { id: generateUuid(), ...defaultValues });
        return newInputs;
      });
      setDmnRunnerContextProviderState({
        type: DmnRunnerProviderActionType.DEFAULT,
        newState: { currentInputIndex: args.beforeIndex },
      });
      setDmnRunnerResults({ type: DmnRunnerResultsActionType.CLONE_LAST });
    },
    [setDmnRunnerInputs, jsonSchema]
  );

  const onRowDuplicated = useCallback(
    (args: { rowIndex: number }) => {
      setDmnRunnerInputs((previousInputs) => {
        const newInputs = cloneDeep(previousInputs);
        newInputs.splice(args.rowIndex, 0, {
          ...JSON.parse(JSON.stringify(previousInputs[args.rowIndex])),
          id: generateUuid(),
        });
        return newInputs;
      });
      setDmnRunnerResults({ type: DmnRunnerResultsActionType.CLONE_LAST });
    },
    [setDmnRunnerInputs]
  );

  const onRowReset = useCallback(
    (args: { rowIndex: number }) => {
      setDmnRunnerInputs((previousInputs) => {
        const newInputs = cloneDeep(previousInputs);
        const defaultValues = getDefaultValues(jsonSchema ?? {});
        newInputs[args.rowIndex] = { id: generateUuid(), ...defaultValues };
        return newInputs;
      });
    },
    [jsonSchema, setDmnRunnerInputs]
  );

  const onRowDeleted = useCallback(
    (args: { rowIndex: number }) => {
      setDmnRunnerInputs((previousInputs) => {
        const newInputs = cloneDeep(previousInputs);
        newInputs.splice(args.rowIndex, 1);
        newInputs.forEach((e, i, newInputRows) => {
          if (i >= args.rowIndex) {
            newInputRows[i] = { ...e, id: generateUuid() };
          }
        });
        return newInputs;
      });
    },
    [setDmnRunnerInputs]
  );

  const dmnRunnerDispatch = useMemo(
    () => ({
      setDmnRunnerContextProviderState,
      onRowAdded,
      onRowDeleted,
      onRowDuplicated,
      onRowReset,
      setDmnRunnerConfigInputs,
      setDmnRunnerInputs,
      setDmnRunnerMode,
      setDmnRunnerPersistenceJson,
    }),
    [
      onRowAdded,
      onRowDeleted,
      onRowDuplicated,
      onRowReset,
      setDmnRunnerConfigInputs,
      setDmnRunnerInputs,
      setDmnRunnerMode,
      setDmnRunnerPersistenceJson,
    ]
  );

  const dmnRunnerState = useMemo(
    () => ({
      canBeVisualized,
      configs: dmnRunnerConfigInputs,
      currentInputIndex,
      dmnRunnerKey,
      dmnRunnerPersistenceJson,
      extendedServicesError,
      inputs: dmnRunnerInputs,
      isExpanded,
      jsonSchema,
      mode: dmnRunnerMode,
      results,
      resultsDifference,
      status,
    }),
    [
      canBeVisualized,
      currentInputIndex,
      dmnRunnerConfigInputs,
      dmnRunnerInputs,
      dmnRunnerKey,
      dmnRunnerMode,
      dmnRunnerPersistenceJson,
      extendedServicesError,
      isExpanded,
      jsonSchema,
      results,
      resultsDifference,
      status,
    ]
  );

  return (
    <>
      <DmnRunnerStateContext.Provider value={dmnRunnerState}>
        <DmnRunnerDispatchContext.Provider value={dmnRunnerDispatch}>
          {props.children}
        </DmnRunnerDispatchContext.Provider>
      </DmnRunnerStateContext.Provider>
    </>
  );
}

export function DmnRunnerExtendedServicesError() {
  return (
    <div>
      <EmptyState>
        <EmptyStateHeader icon={<EmptyStateIcon icon={ExclamationIcon} />} />
        <TextContent>
          <Text component={"h2"}>Error</Text>
        </TextContent>
        <EmptyStateBody>
          <p>An error has happened while trying to show your inputs</p>
          <br />
          <p>
            If your DMN file has included models, please check if they still exist. If you have deleted a file that was
            being used as an included model, please remove its reference in the Included Models tab.
          </p>
        </EmptyStateBody>
      </EmptyState>
    </div>
  );
}
