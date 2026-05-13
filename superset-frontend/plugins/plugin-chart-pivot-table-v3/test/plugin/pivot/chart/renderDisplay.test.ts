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
  MetricsLayoutEnum,
  type MeasureHierarchy,
  type PivotTreeNode,
} from '../../../../src/types';
import {
  buildColumnDisplayPath,
  expandMetricNodesForRender,
  resolveColumnHeaderLabel,
} from '../../../../src/pivot/chart/renderDisplay';
import {
  encodeMeasureLeafKey,
  encodeMetricKey,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../../src/utils';

const node = (path: PivotTreeNode['path'], overrides = {}): PivotTreeNode => ({
  axis: 'col',
  key: path.length === 0 ? '__root__' : serializePath(path),
  path,
  label: String(path[path.length - 1] ?? 'Total'),
  formattedLabel: String(path[path.length - 1] ?? 'Total'),
  level: path.length,
  hasChildren: false,
  ...overrides,
});

const baseDisplayConfig = {
  metricsLayout: MetricsLayoutEnum.COLUMNS,
  metricsFirstOnCols: false,
  metricsAtColEnd: true,
  allowMetricSubtotalLabels: true,
  metricLabels: ['sales', 'profit'],
  isExplicitSubtotalNode: (candidate: PivotTreeNode) =>
    candidate.path.some(value => value === SUBTOTAL_TOKEN),
  getMetricKeyFromPath: (path: PivotTreeNode['path']) =>
    path
      .map(value =>
        typeof value === 'string' && value.startsWith('__metric__')
          ? value.slice('__metric__'.length)
          : undefined,
      )
      .find((value): value is string => Boolean(value)),
  getMetricDisplayLabelForKey: (metricKey: string) =>
    metricKey === 'sales' ? 'Sales' : 'Profit',
  getNonMetricPathParts: (path: PivotTreeNode['path']) =>
    path.filter(
      value =>
        !(typeof value === 'string' && value.startsWith('__metric__')) &&
        value !== SUBTOTAL_TOKEN,
    ),
  isMetricGrandTotalNode: () => false,
  isMetricSubtotalNode: (candidate: PivotTreeNode) =>
    candidate.isSubtotal === true,
};

test('pads expanded metric-first column headers to the render depth', () => {
  const col = node([encodeMetricKey('sales')]);

  expect(
    buildColumnDisplayPath(col, 3, {
      ...baseDisplayConfig,
      metricsFirstOnCols: true,
      isExpanded: () => true,
    }),
  ).toEqual([encodeMetricKey('sales'), SUBTOTAL_TOKEN]);
});

test('labels metric subtotal headers at the end of column dimensions', () => {
  const col = node(['West', encodeMetricKey('sales')], {
    isSubtotal: true,
    hasChildren: true,
  });

  expect(buildColumnDisplayPath(col, 2, baseDisplayConfig)).toEqual([
    'West Sales',
  ]);
});

test('resolves metric and measure-leaf column header labels', () => {
  const measureHierarchy: MeasureHierarchy = {
    kind: 'measureStackV1',
    leafTierVisibility: 'visible',
    groups: [
      {
        metricKey: 'sales',
        leaves: [
          { kind: 'builtIn', id: 'value', operator: 'value', label: 'Value' },
        ],
      },
    ],
  };

  expect(
    resolveColumnHeaderLabel({
      rawValue: encodeMetricKey('sales'),
      measureHierarchy,
      getMetricDisplayLabelForKey: () => 'Sales',
    }),
  ).toBe('Sales');
  expect(
    resolveColumnHeaderLabel({
      rawValue: encodeMeasureLeafKey('value'),
      measureHierarchy,
      getMetricDisplayLabelForKey: () => 'Sales',
    }),
  ).toBe('Value');
});

test('adds metric nodes to expanded render state only when the leaf tier is visible', () => {
  const metricNode = node(['West', encodeMetricKey('sales')]);
  const expanded = new Set<string>();
  const nodes = { [metricNode.key]: metricNode };

  expect(
    expandMetricNodesForRender({
      expanded,
      nodes,
      isLeafTierVisible: false,
      isMetricTokenValue: value =>
        typeof value === 'string' && value.startsWith('__metric__'),
    }),
  ).toBe(expanded);
  expect(
    expandMetricNodesForRender({
      expanded,
      nodes,
      isLeafTierVisible: true,
      isMetricTokenValue: value =>
        typeof value === 'string' && value.startsWith('__metric__'),
    }).has(metricNode.key),
  ).toBe(true);
});
