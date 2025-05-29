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
import { useMemo } from "react";
import { FormDmnValidator } from "./FormDmnValidator";
import { formDmnI18n } from "./i18n";
import { FormComponent, FormProps } from "@kie-tools/form/dist/FormComponent";
import { DmnAutoFieldProvider } from "@kie-tools/dmn-runner/dist/uniforms";
import { formDmnRunnerAutoFieldValue } from "./uniforms/FormDmnRunnerAutoFieldValue";
import { JSONSchema4 } from "json-schema";

export type InputRow = Record<string, any>;

export function FormDmn(props: FormProps<any, JSONSchema4>) {
  const i18n = useMemo(() => {
    formDmnI18n.setLocale(props.locale ?? navigator.language);
    return formDmnI18n.getCurrent();
  }, [props.locale]);

  const dmnValidator = useMemo(() => new FormDmnValidator(i18n), [i18n]);
  const mergedSchema = useMemo(() => {
    const originalSchema = props.formSchema ?? {};
    const definitions = originalSchema.definitions ?? {};
    const mainInputSet = definitions.InputSet as JSONSchema4;
    const includedInputSets = Object.entries(definitions).filter(([key]) => key.startsWith("InputSetDMN__"));

    const includedNamespaceProps: Record<string, JSONSchema4> = {};
    let includedRequired: string[] = [];

    includedInputSets.forEach(([_, schema]) => {
      if (schema && schema.type === "object" && schema.properties) {
        Object.entries(schema.properties).forEach(([propName, propSchema]) => {
          includedNamespaceProps[propName] = propSchema as JSONSchema4;
        });
        if (Array.isArray(schema.required)) {
          includedRequired = [...includedRequired, ...schema.required];
        }
      }
    });

    const merged = {
      type: "object",
      properties: {
        ...(mainInputSet?.properties ?? {}),
        nmspc: {
          type: "object",
          properties: includedNamespaceProps,
          required: includedRequired.length > 0 ? includedRequired : undefined,
        },
      },
      required: mainInputSet?.required,
      definitions,
      $schema: originalSchema.$schema,
    };
    console.log("form merged", merged);
    return merged;
  }, [props.formSchema]);

  return (
    <FormComponent
      {...props}
      formSchema={mergedSchema}
      i18n={i18n}
      validator={dmnValidator}
      removeRequired={true}
      entryPath={undefined}
      propertiesEntryPath={undefined}
    >
      <DmnAutoFieldProvider value={formDmnRunnerAutoFieldValue} />
    </FormComponent>
  );
}
