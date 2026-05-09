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
  Datasource,
  DatasourceType,
  SetDataMaskHook,
  supersetTheme,
} from '@superset-ui/core';
import PivotTableChart from '../../../src/PivotTableChart';
import { PivotTableProps, PivotTreeData } from '../../../src/types';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { collectLoadedBranchPaths } from '../../../src/pivot/runtime/loadedBranchCoverage';
import { buildFormData } from './pivotFormData';

const noopSetDataMask: SetDataMaskHook = () => undefined;

const emptyTree: PivotTreeData = {
  rows: {},
  cols: {},
  cells: {},
};

const baseDatasource: Datasource = {
  id: 1,
  name: 'pivot-table-test',
  type: DatasourceType.Table,
  columns: [],
  metrics: [],
  columnFormats: {},
  currencyFormats: {},
  verboseMap: {},
};

const baseFormData = buildFormData({});
const emptyMetrics: PivotTableProps['metrics'] = [];
const emptyGroupbyRows: PivotTableProps['groupbyRows'] = [];
const emptyGroupbyColumns: PivotTableProps['groupbyColumns'] = [];
const emptyQueriesData: PivotTableProps['queriesData'] = [];

const maxPathDepth = (nodes: PivotTreeData['rows']) =>
  Object.values(nodes).reduce(
    (depth, node) => Math.max(depth, node.path.length),
    0,
  );

export const buildPreloadedBootstrapFactBatches = (
  tree: PivotTreeData | undefined,
  groupby: Pick<PivotTableProps, 'groupbyRows' | 'groupbyColumns'> = {
    groupbyRows: [],
    groupbyColumns: [],
  },
): PivotFactStoreBatch[] => {
  if (!tree) {
    return [];
  }
  const rowDepth = maxPathDepth(tree.rows);
  const colDepth = maxPathDepth(tree.cols);
  const bootstrapRowDepth =
    groupby.groupbyRows.length > 0 && rowDepth > 0 ? 1 : 0;
  const bootstrapColDepth =
    groupby.groupbyColumns.length > 0 && colDepth > 0 ? 1 : 0;
  return [
    {
      coverage: {
        reason: 'initial',
        rowDepth: bootstrapRowDepth,
        columnDepth: bootstrapColDepth,
        rowDimensions: groupby.groupbyRows.slice(0, bootstrapRowDepth),
        columnDimensions: groupby.groupbyColumns.slice(0, bootstrapColDepth),
      },
      facts: [],
      scope: {
        kind: 'bootstrap',
      },
    },
  ];
};

export const buildPreloadedBranchFactBatches = (
  tree: PivotTreeData | undefined,
  groupby: Pick<PivotTableProps, 'groupbyRows' | 'groupbyColumns'> = {
    groupbyRows: [],
    groupbyColumns: [],
  },
): PivotFactStoreBatch[] => {
  if (!tree) {
    return [];
  }
  const rowDepth = maxPathDepth(tree.rows);
  const colDepth = maxPathDepth(tree.cols);
  const batches: PivotFactStoreBatch[] = [];
  (
    [
      ['row', tree.rows],
      ['col', tree.cols],
    ] as const
  ).forEach(([axis]) => {
    collectLoadedBranchPaths({
      axis,
      tree,
      basePaths: [[]],
    }).forEach(path => {
      batches.push({
        coverage: {
          reason: 'initial',
          rowDepth,
          columnDepth: colDepth,
          rowDimensions: groupby.groupbyRows.slice(0, rowDepth),
          columnDimensions: groupby.groupbyColumns.slice(0, colDepth),
        },
        facts: [],
        scope: {
          kind: 'branch',
          axis,
          path,
        },
      });
    });
  });
  return batches;
};

export const buildPreloadedRenderedBranchFactBatches = (
  tree: PivotTreeData | undefined,
  groupby: Pick<PivotTableProps, 'groupbyRows' | 'groupbyColumns'> = {
    groupbyRows: [],
    groupbyColumns: [],
  },
): PivotFactStoreBatch[] => {
  if (!tree) {
    return [];
  }
  const rowDepth = maxPathDepth(tree.rows);
  const colDepth = maxPathDepth(tree.cols);
  const batches: PivotFactStoreBatch[] = [];
  (
    [
      ['row', tree.rows],
      ['col', tree.cols],
    ] as const
  ).forEach(([axis, nodes]) => {
    Object.values(nodes).forEach(node => {
      if (!node.hasChildren) {
        return;
      }
      batches.push({
        coverage: {
          reason: 'initial',
          rowDepth,
          columnDepth: colDepth,
          rowDimensions: groupby.groupbyRows.slice(0, rowDepth),
          columnDimensions: groupby.groupbyColumns.slice(0, colDepth),
        },
        facts: [],
        scope: {
          kind: 'branch',
          axis,
          path: node.path,
        },
      });
    });
  });
  return batches;
};

export const buildPreloadedTreeFactBatches = (
  tree: PivotTreeData | undefined,
  groupby: Pick<PivotTableProps, 'groupbyRows' | 'groupbyColumns'> = {
    groupbyRows: [],
    groupbyColumns: [],
  },
): PivotFactStoreBatch[] => [
  ...buildPreloadedBootstrapFactBatches(tree, groupby),
  ...buildPreloadedBranchFactBatches(tree, groupby),
];

export const buildPreloadedRenderedTreeFactBatches = (
  tree: PivotTreeData | undefined,
  groupby: Pick<PivotTableProps, 'groupbyRows' | 'groupbyColumns'> = {
    groupbyRows: [],
    groupbyColumns: [],
  },
): PivotFactStoreBatch[] => [
  ...buildPreloadedBootstrapFactBatches(tree, groupby),
  ...buildPreloadedRenderedBranchFactBatches(tree, groupby),
];

const baseProps: PivotTableProps = {
  data: emptyTree,
  formData: baseFormData,
  rawFormData: baseFormData,
  metrics: emptyMetrics,
  groupbyRows: emptyGroupbyRows,
  groupbyColumns: emptyGroupbyColumns,
  aggregateFunction: 'Sum',
  startCollapsed: false,
  colTotals: false,
  rowTotals: false,
  rowSubTotals: false,
  rowSubtotalLevels: [],
  colSubtotalLevels: [],
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  width: 400,
  height: 300,
  margin: 0,
  valueFormat: '',
  columnFormats: {},
  currencyFormats: {},
  allowRenderHtml: false,
  emitCrossFilters: false,
  setDataMask: noopSetDataMask,
  metricColorFormatters: [],
  dateFormatters: {},
  verboseMap: {},
  annotationData: {},
  datasource: baseDatasource,
  rawDatasource: baseDatasource,
  initialValues: {},
  hooks: { setDataMask: noopSetDataMask },
  ownState: {},
  filterState: {},
  queriesData: emptyQueriesData,
  behaviors: [],
  theme: supersetTheme,
};

type TestPivotTableChartProps = Partial<PivotTableProps>;

export default function TestPivotTableChart(props: TestPivotTableChartProps) {
  const mergedProps: PivotTableProps = {
    ...baseProps,
    ...props,
    formData: props.formData ?? baseProps.formData,
    rawFormData: props.rawFormData ?? props.formData ?? baseProps.rawFormData,
    datasource: props.datasource ?? baseProps.datasource,
    rawDatasource: props.rawDatasource ?? baseProps.rawDatasource,
    hooks: { ...baseProps.hooks, ...(props.hooks ?? {}) },
  };
  const runtimeLayout = mergedProps.formData.pivotRuntimeLayout;

  return (
    <PivotTableChart
      {...mergedProps}
      factBatches={
        props.factBatches ??
        buildPreloadedTreeFactBatches(mergedProps.data, {
          groupbyRows: runtimeLayout?.rows ?? mergedProps.groupbyRows,
          groupbyColumns: runtimeLayout?.cols ?? mergedProps.groupbyColumns,
        })
      }
    />
  );
}
