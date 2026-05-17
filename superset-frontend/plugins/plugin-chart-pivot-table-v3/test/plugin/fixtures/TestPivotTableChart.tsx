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
import {
  PivotAxis,
  PivotPath,
  PivotTableProps,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../src/types';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { serializePath } from '../../../src/pivot/core/path';
import {
  isMeasureLeafToken,
  isMetricToken,
  isSubtotalToken,
} from '../../../src/pivot/core/tokens';
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
const emptyGroupbyRows: PivotTableQueryFormData['groupbyRows'] = [];
const emptyGroupbyColumns: PivotTableQueryFormData['groupbyColumns'] = [];
const emptyQueriesData: PivotTableProps['queriesData'] = [];

type LegacyTestPivotProps = {
  groupbyRows: PivotTableQueryFormData['groupbyRows'];
  groupbyColumns: PivotTableQueryFormData['groupbyColumns'];
  aggregateFunction?: PivotTableQueryFormData['aggregateFunction'];
  valueFormat?: PivotTableQueryFormData['valueFormat'];
  columnFormats?: PivotTableQueryFormData['columnFormats'];
  currencyFormats?: PivotTableQueryFormData['currencyFormats'];
  allowRenderHtml?: PivotTableQueryFormData['allowRenderHtml'];
  metricColorFormatters?: unknown[];
};

const isDimensionalChildValue = (value: PivotPath[number]) =>
  !isMetricToken(value) &&
  !isMeasureLeafToken(value) &&
  !isSubtotalToken(value);

const countDimensionalPathDepth = (path: PivotPath) =>
  path.filter(isDimensionalChildValue).length;

const maxPathDepth = (nodes: PivotTreeData['rows']) =>
  Object.values(nodes).reduce(
    (depth, node) => Math.max(depth, countDimensionalPathDepth(node.path)),
    0,
  );

const pathStartsWith = (path: PivotPath, basePath: PivotPath) =>
  basePath.every((value, index) => path[index] === value);

const isSameOrDescendantPath = (path: PivotPath, basePath: PivotPath) =>
  path.length >= basePath.length && pathStartsWith(path, basePath);

const isDirectChildPath = (childPath: PivotPath, parentPath: PivotPath) =>
  childPath.length === parentPath.length + 1 &&
  pathStartsWith(childPath, parentPath);

const pathHasMetricToken = (path: PivotPath) => path.some(isMetricToken);

const collectTreeValueKeys = (tree: PivotTreeData) =>
  Array.from(
    new Set([
      ...Object.values(tree.rows).flatMap(node =>
        Object.keys(node.values ?? {}),
      ),
      ...Object.values(tree.cols).flatMap(node =>
        Object.keys(node.values ?? {}),
      ),
      ...Object.values(tree.cells).flatMap(cell => Object.keys(cell.values)),
    ]),
  ).sort();

const collectLoadedBranchPaths = ({
  axis,
  tree,
  basePaths,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  basePaths: PivotPath[];
}): PivotPath[] => {
  const pathsByKey = new Map<string, PivotPath>();
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const hasLoadedDimensionalChild = (path: PivotPath) => {
    const parentDimDepth = countDimensionalPathDepth(path);
    return Object.values(nodes).some(node => {
      if (
        !isSameOrDescendantPath(node.path, path) ||
        node.path.length === path.length
      ) {
        return false;
      }
      return countDimensionalPathDepth(node.path) === parentDimDepth + 1;
    });
  };
  const hasLoadedRawDimensionalChild = (path: PivotPath) =>
    Object.values(nodes).some(node => {
      if (!isDirectChildPath(node.path, path)) {
        return false;
      }
      return isDimensionalChildValue(node.path[path.length]);
    });

  Object.values(nodes).forEach(node => {
    if (
      !basePaths.some(basePath => isSameOrDescendantPath(node.path, basePath))
    ) {
      return;
    }
    if (
      pathHasMetricToken(node.path) &&
      (!node.hasChildren || node.path.some(isSubtotalToken))
    ) {
      pathsByKey.set(serializePath(node.path), node.path);
      return;
    }
    if (!node.hasChildren) {
      return;
    }
    if (
      hasLoadedRawDimensionalChild(node.path) ||
      hasLoadedDimensionalChild(node.path)
    ) {
      pathsByKey.set(serializePath(node.path), node.path);
    }
  });

  return Array.from(pathsByKey.values());
};

export const buildPreloadedBootstrapFactBatches = (
  tree: PivotTreeData | undefined,
  groupby: Pick<LegacyTestPivotProps, 'groupbyRows' | 'groupbyColumns'> = {
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
  const valueKeys = collectTreeValueKeys(tree);
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
      valueKeys,
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
  const valueKeys = collectTreeValueKeys(tree);
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
        valueKeys,
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
  groupby: Pick<LegacyTestPivotProps, 'groupbyRows' | 'groupbyColumns'> = {
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
  const valueKeys = collectTreeValueKeys(tree);
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
        valueKeys,
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
  groupby: Pick<LegacyTestPivotProps, 'groupbyRows' | 'groupbyColumns'> = {
    groupbyRows: [],
    groupbyColumns: [],
  },
): PivotFactStoreBatch[] => [
  ...buildPreloadedBootstrapFactBatches(tree, groupby),
  ...buildPreloadedRenderedBranchFactBatches(tree, groupby),
];

const baseProps: PivotTableProps & LegacyTestPivotProps = {
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

type TestPivotTableChartProps = Partial<PivotTableProps & LegacyTestPivotProps>;

export default function TestPivotTableChart(props: TestPivotTableChartProps) {
  const mergedProps: PivotTableProps & LegacyTestPivotProps = {
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
