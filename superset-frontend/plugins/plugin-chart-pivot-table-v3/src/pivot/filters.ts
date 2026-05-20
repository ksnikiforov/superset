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
import {
  BinaryQueryObjectFilterClause,
  DataRecordValue,
  QueryFormColumn,
  QueryObjectFilterClause,
  UnaryQueryObjectFilterClause,
  getColumnLabel,
} from '@superset-ui/core';
import { DateFormatter, PivotTreeNode } from '../types';
import { getStableColumnKey } from '../utils';
import { decodeMetricKey, isSubtotalToken } from './core/tokens';
import { createMetricNodePolicy } from './metricsTotals';
import type { PivotProgram } from './runtime/types';

export type PivotSelectedFilters = Record<string, DataRecordValue[]>;

export const hasSelectedFilters = (filters: PivotSelectedFilters): boolean =>
  Object.keys(filters).length > 0;

export const firstSelectedFilters = (
  ...sources: PivotSelectedFilters[]
): PivotSelectedFilters => sources.find(hasSelectedFilters) ?? {};

export const normalizePivotSelectedFilters = ({
  filters,
  dimensions,
}: {
  filters?: PivotSelectedFilters;
  dimensions: QueryFormColumn[];
}): PivotSelectedFilters => {
  if (!filters) {
    return {};
  }
  const dimensionKeys = new Set(
    dimensions.map(dimension => getStableColumnKey(dimension)),
  );
  const normalized: PivotSelectedFilters = {};
  Object.entries(filters).forEach(([key, values]) => {
    if (dimensionKeys.has(key)) {
      normalized[key] = values;
    }
  });
  return normalized;
};

export const buildRuntimeSelectionSyncState = ({
  dimensions,
  selectedFiltersFromFormData,
  selectedFiltersFromOwnState,
  selectedFiltersFromProps,
  committedFilters,
}: {
  dimensions: QueryFormColumn[];
  selectedFiltersFromFormData: PivotSelectedFilters;
  selectedFiltersFromOwnState: PivotSelectedFilters;
  selectedFiltersFromProps: PivotSelectedFilters;
  committedFilters: PivotSelectedFilters;
}) => {
  const selectedFiltersForTreeSync = firstSelectedFilters(
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
  );
  const persistedInteractionFilters = normalizePivotSelectedFilters({
    filters: firstSelectedFilters(
      selectedFiltersFromFormData,
      selectedFiltersFromOwnState,
    ),
    dimensions,
  });
  const persistedSelectedFilters = normalizePivotSelectedFilters({
    filters: firstSelectedFilters(
      selectedFiltersFromFormData,
      selectedFiltersFromOwnState,
      committedFilters,
      selectedFiltersFromProps,
    ),
    dimensions,
  });
  return {
    selectedFiltersForTreeSync,
    persistedInteractionFilters,
    persistedSelectedFilters,
  };
};

export const buildTreeDimensionFilterValues = ({
  dimensions,
  rows,
  cols,
  program,
}: {
  dimensions: QueryFormColumn[];
  rows: Record<string, PivotTreeNode>;
  cols: Record<string, PivotTreeNode>;
  program: PivotProgram;
}): PivotSelectedFilters => {
  const metricNodePolicy = createMetricNodePolicy(program);
  const valuesMap = new Map<string, Set<DataRecordValue>>();
  const dimensionKeys = new Set(
    dimensions.map(dimension => getStableColumnKey(dimension)),
  );
  const addValue = (key: string, value: DataRecordValue) => {
    const set = valuesMap.get(key) ?? new Set<DataRecordValue>();
    set.add(value);
    valuesMap.set(key, set);
  };
  const collectValues = (
    nodes: Record<string, PivotTreeNode>,
    axis: 'row' | 'col',
  ) => {
    Object.values(nodes).forEach(node => {
      if (node.isSubtotal) {
        return;
      }
      const dimensionKey = metricNodePolicy.getDimensionKeyForNode(node, axis);
      if (!dimensionKey || !dimensionKeys.has(dimensionKey)) {
        return;
      }
      const parts = metricNodePolicy.getNonMetricPathParts(node.path);
      if (parts.length === 0) {
        return;
      }
      const normalized = (parts[parts.length - 1] ?? null) as DataRecordValue;
      addValue(dimensionKey, normalized);
    });
  };
  collectValues(rows, 'row');
  collectValues(cols, 'col');
  return Object.fromEntries(
    Array.from(valuesMap.entries()).map(([key, set]) => [
      key,
      Array.from(set.values()),
    ]),
  );
};

export const applyDimensionFilterSelectionChange = ({
  selection,
  dimensionKey,
  values,
}: {
  selection: PivotSelectedFilters;
  dimensionKey: string;
  values: DataRecordValue[];
}) => {
  const nextSelection = { ...selection };
  if (values.length > 0) {
    nextSelection[dimensionKey] = values;
    return {
      selection: nextSelection,
      suppressStalePersistedFilterRestore: false,
    };
  }
  delete nextSelection[dimensionKey];
  return {
    selection: nextSelection,
    suppressStalePersistedFilterRestore:
      hasSelectedFilters(selection) && !hasSelectedFilters(nextSelection),
  };
};

export const buildClearSelectedFiltersUpdate = (
  selection: PivotSelectedFilters,
) =>
  hasSelectedFilters(selection)
    ? {
        selection: {},
        suppressStalePersistedFilterRestore: true,
      }
    : null;

const stripMetricPath = (
  path: PivotTreeNode['path'],
  axis: 'row' | 'col',
  program: PivotProgram,
) => {
  const shouldStripMetric = axis === program.valueAxis;
  const metricLabels = new Set(program.metricKeys);
  return path.filter(val => {
    if (isSubtotalToken(val)) {
      return false;
    }
    const decoded = decodeMetricKey(val);
    return !(shouldStripMetric && decoded && metricLabels.has(decoded));
  });
};

type CellFiltersParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  program: PivotProgram;
};

export const buildCellFilters = ({
  rowNode,
  colNode,
  program,
}: CellFiltersParams): QueryObjectFilterClause[] => {
  const normalizedRowPath = stripMetricPath(rowNode.path, 'row', program);
  const normalizedColPath = stripMetricPath(colNode.path, 'col', program);
  const toFilter = (
    col: QueryFormColumn,
    val: PivotTreeNode['path'][number],
  ): QueryObjectFilterClause => {
    if (val === null || val === undefined) {
      const clause: UnaryQueryObjectFilterClause = { col, op: 'IS NULL' };
      return clause;
    }
    const clause: BinaryQueryObjectFilterClause = { col, op: '==', val };
    return clause;
  };
  return [
    ...normalizedRowPath.map((val, i) =>
      toFilter(program.rowDimensions[i], val),
    ),
    ...normalizedColPath.map((val, i) =>
      toFilter(program.columnDimensions[i], val),
    ),
  ];
};

type ContextFiltersParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  program: PivotProgram;
  dateFormatters: Record<string, DateFormatter | undefined>;
  timeGrainSqla?: string;
};

const buildAxisContextFilters = (
  node: PivotTreeNode,
  columns: QueryFormColumn[],
  axis: 'row' | 'col',
  program: PivotProgram,
  dateFormatters: Record<string, DateFormatter | undefined>,
  timeGrainSqla?: string,
) =>
  stripMetricPath(node.path, axis, program).map((val, idx) => {
    const col = columns[idx];
    const colLabel = getColumnLabel(col);
    const formatter = dateFormatters[colLabel];
    const normalizedVal = val === undefined ? null : val;
    return {
      col,
      op: '==',
      val: normalizedVal,
      formattedVal:
        typeof formatter === 'function'
          ? (formatter as unknown as (value: DataRecordValue) => string)(
              normalizedVal,
            )
          : String(normalizedVal),
      grain: formatter && axis === 'row' ? timeGrainSqla : undefined,
    } as BinaryQueryObjectFilterClause;
  });

export const buildContextMenuFilters = ({
  rowNode,
  colNode,
  program,
  dateFormatters,
  timeGrainSqla,
}: ContextFiltersParams): BinaryQueryObjectFilterClause[] => [
  ...buildAxisContextFilters(
    rowNode,
    program.rowDimensions,
    'row',
    program,
    dateFormatters,
    timeGrainSqla,
  ),
  ...buildAxisContextFilters(
    colNode,
    program.columnDimensions,
    'col',
    program,
    dateFormatters,
    timeGrainSqla,
  ),
];
