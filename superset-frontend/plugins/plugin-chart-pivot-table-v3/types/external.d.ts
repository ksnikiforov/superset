/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

declare module '*.png' {
  const value: any;
  export default value;
}

declare module '*.jpg';

declare module 'fast-formula-parser' {
  export type FormulaPosition = {
    row: number;
    col: number;
    sheet?: string;
  };

  export type CellRef = {
    sheet?: string;
    row: number;
    col: number;
  };

  export type RangeRef = {
    sheet?: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  };

  export type FormulaParserConfig = {
    onVariable?: (
      name: string,
      sheetName?: string,
      position?: FormulaPosition,
    ) => unknown;
    onCell?: (ref: CellRef) => unknown;
    onRange?: (ref: RangeRef) => unknown;
    functions?: Record<string, (...args: unknown[]) => unknown>;
    functionsNeedContext?: Record<string, (...args: unknown[]) => unknown>;
  };

  export default class FormulaParser {
    constructor(config?: FormulaParserConfig, isTest?: boolean);
    parse(
      inputText: string,
      position?: FormulaPosition,
      allowReturnArray?: boolean,
    ): unknown;
    parseAsync(
      inputText: string,
      position?: FormulaPosition,
      allowReturnArray?: boolean,
    ): Promise<unknown>;
    static FormulaError: { new (...args: unknown[]): Error };
  }
}
