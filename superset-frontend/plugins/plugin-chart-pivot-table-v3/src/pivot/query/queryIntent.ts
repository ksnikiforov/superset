/**
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
import { type MetricFormattingScope, type PivotAxis } from '../../types';

export type QueryIntentKind = 'branch' | 'wholeLevel' | 'totalsOnly';

export type QueryIntent = {
  kind: QueryIntentKind;
  axis?: PivotAxis;
  targetRowDepth: number;
  targetColDepth: number;
  needsValueCells: boolean;
  needsTotals: boolean;
  needsMetricFormatting: boolean;
  needsDatabars: boolean;
  needsRowOrdering: boolean;
  needsColOrdering: boolean;
  needsRowDimensionFormatting: boolean;
  needsColDimensionFormatting: boolean;
};

export const shouldIncludeMetricFormatting = (
  scope: MetricFormattingScope | undefined,
  intent: QueryIntent,
): boolean => {
  if (!intent.needsMetricFormatting) {
    return false;
  }
  const formattingScope = scope ?? 'values_totals';
  if (formattingScope === 'values') {
    return intent.needsValueCells;
  }
  if (formattingScope === 'values_totals') {
    return intent.needsValueCells || intent.needsTotals;
  }
  return intent.needsValueCells || intent.needsTotals;
};

export const shouldIncludeDatabars = (intent: QueryIntent): boolean =>
  intent.needsDatabars && intent.needsValueCells;

