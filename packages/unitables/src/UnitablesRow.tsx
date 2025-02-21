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
import { PropsWithChildren, useCallback, useRef, useEffect, useImperativeHandle } from "react";
import { AutoRow } from "./uniforms/AutoRow";
import { createPortal } from "react-dom";
import { context as UniformsContext } from "uniforms";
import { AUTO_ROW_ID, UnitablesJsonSchemaBridge } from "./uniforms";
import { DmnAutoFieldProvider } from "@kie-tools/dmn-runner/dist/uniforms/DmnAutoFieldProvider";
import { unitablesDmnRunnerAutoFieldValue } from "./uniforms/UnitablesDmnRunnerAutoFieldValue";
import { UnitablesValidator } from "./UnitablesValidator";
import { unitablesI18n } from "./i18n";

interface Props {
  formsId: string;
  rowIndex: number;
  jsonSchemaBridge: UnitablesJsonSchemaBridge;
  rowInput: Record<string, any>;
  onSubmitRow: (rowInput: Record<string, any>, index: number, error: Record<string, any>) => void;
}

export interface UnitablesRowApi {
  submit: () => void;
}

export const UnitablesRow = React.forwardRef<UnitablesRowApi, PropsWithChildren<Props>>(
  ({ children, formsId, rowIndex, jsonSchemaBridge, rowInput, onSubmitRow }, forwardRef) => {
    const autoRowRef = useRef<HTMLFormElement>(null);
    const i18n = React.useMemo(() => {
      unitablesI18n.setLocale(navigator.language);
      return unitablesI18n.getCurrent();
    }, []);
    const dmnValidator = React.useMemo(() => new UnitablesValidator(i18n), [i18n]);
    const onSubmit = useCallback(
      (rowInput: Record<string, any>) => {
        console.debug("DMN RUNNER TABLE: submit row: ", rowIndex);
        onSubmitRow(rowInput, rowIndex, {});
      },
      [onSubmitRow, rowIndex]
    );

    const onValidate = useCallback(
      (inputs, error) => {
        if (!error) {
          return null;
        }

        const {
          details,
          changes,
        }: {
          details: object[];
          changes: Array<[string, string | number | undefined]>;
        } = error.details.reduce(
          (infos: any, detail: any) => {
            infos.details = [...infos.details, detail];
            return infos;
          },
          { details: [], changes: [] }
        );

        changes.forEach(([formFieldPath, fieldValue]) => {
          formFieldPath?.split(".")?.reduce((deeper, field, index, array) => {
            if (index === array.length - 1) {
              deeper[field] = fieldValue;
            } else {
              return deeper[field];
            }
          }, inputs);
        });
        return { details };
      },

      []
    );

    useImperativeHandle(forwardRef, () => {
      return {
        submit: () => autoRowRef.current?.submit(),
      };
    }, []);

    // Submits the table in the first render triggering the onValidate function
    useEffect(() => {
      autoRowRef.current?.submit();
    }, [autoRowRef]);

    return (
      <>
        <AutoRow
          ref={autoRowRef}
          schema={jsonSchemaBridge}
          model={rowInput}
          onSubmit={onSubmit}
          placeholder={true}
          validate={"onSubmit"}
          onValidate={onValidate}
          validator={dmnValidator}
        >
          <UniformsContext.Consumer>
            {(uniformsContext) => (
              <>
                {createPortal(
                  <form id={`${AUTO_ROW_ID}-${rowIndex}`} onSubmit={(data) => uniformsContext?.onSubmit(data)} />,
                  document.getElementById(formsId)!
                )}
                <DmnAutoFieldProvider value={unitablesDmnRunnerAutoFieldValue}>{children}</DmnAutoFieldProvider>
              </>
            )}
          </UniformsContext.Consumer>
        </AutoRow>
      </>
    );
  }
);
