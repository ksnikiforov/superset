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
import { useCallback, useMemo } from 'react';
import {
  type MeasureHierarchy,
  type PivotTableProps,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { resolveMetricDisplayLabel } from '../../utils';
import { decodeMetricKey, findMeasureLeafIdInPath } from '../core/tokens';
import { buildLayoutContext } from '../layout/LayoutContext';
import type { PivotProgram } from '../runtime/types';
import { getMetricLabelFromPath } from '../metricsTotals';
import { isValuesFirstOnAxis } from '../runtime/projection';

export type PivotLayoutResult = {
  layout: ReturnType<typeof buildLayoutContext>;
  expansionSemanticSignature: string;
  normalizedColSubtotalLevels: number[];
  effectiveRowSubtotalPosition: TotalPosition;
  effectiveColSubtotalPosition: TotalPosition;
  compareMetricOrder: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  getRowSubtotalPosition: (node: PivotTreeNode) => TotalPosition;
};

const buildMetricOrderComparator = ({
  program,
  measureHierarchy,
}: {
  program: PivotProgram;
  measureHierarchy: MeasureHierarchy;
}) => {
  const metricLabelSet = new Set(program.metricKeys);
  const metricOrderMap = new Map(
    program.metricKeys.map((label, idx) => [label, idx]),
  );
  const measureLeafOrderMap = new Map<string, Map<string, number>>();
  measureHierarchy.groups.forEach(group => {
    const order = new Map<string, number>();
    group.leaves.forEach((leaf, index) => {
      order.set(leaf.id, index);
    });
    measureLeafOrderMap.set(group.metricKey, order);
  });

  return (a: PivotTreeNode, b: PivotTreeNode) => {
    const aMetric = getMetricLabelFromPath(a.path, metricLabelSet);
    const bMetric = getMetricLabelFromPath(b.path, metricLabelSet);
    if (!aMetric || !bMetric) {
      return 0;
    }
    if (aMetric === bMetric) {
      const leafOrder = measureLeafOrderMap.get(aMetric);
      const aLeaf = findMeasureLeafIdInPath(a.path);
      const bLeaf = findMeasureLeafIdInPath(b.path);
      if (!leafOrder || !aLeaf || !bLeaf || aLeaf === bLeaf) {
        return 0;
      }
      const aIndex = leafOrder.get(aLeaf);
      const bIndex = leafOrder.get(bLeaf);
      return aIndex !== undefined && bIndex !== undefined ? aIndex - bIndex : 0;
    }
    const aIndex = metricOrderMap.get(aMetric);
    const bIndex = metricOrderMap.get(bMetric);
    return aIndex !== undefined && bIndex !== undefined ? aIndex - bIndex : 0;
  };
};

const resolveMetricAxisLayoutPolicy = ({
  program,
  rowSubTotals,
  resolvedRowSubtotalPosition,
  resolvedColSubtotalPosition,
}: {
  program: PivotProgram;
  rowSubTotals: boolean;
  resolvedRowSubtotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
}) => {
  const isMultiMetric = program.metricKeys.length > 1;
  const metricsFirstOnRows = isValuesFirstOnAxis(program, 'row');
  const forceRowSubtotalEnd =
    rowSubTotals &&
    isMultiMetric &&
    program.valueAxis === 'row' &&
    !metricsFirstOnRows;

  return {
    forceRowSubtotalEnd,
    effectiveRowSubtotalPosition: forceRowSubtotalEnd
      ? 'end'
      : resolvedRowSubtotalPosition,
    effectiveColSubtotalPosition:
      isMultiMetric && program.valueAxis === 'col'
        ? 'end'
        : resolvedColSubtotalPosition,
  };
};

export const usePivotLayout = ({
  formData,
  pivotProgram,
}: {
  formData: PivotTableProps['formData'];
  pivotProgram?: PivotProgram;
}): PivotLayoutResult => {
  const layout = useMemo(
    () =>
      buildLayoutContext({
        ...formData,
        colTotals: formData.colTotals ?? true,
        rowSubTotals: formData.rowSubTotals ?? false,
        pivotProgram,
      }),
    [formData, pivotProgram],
  );
  const { metricLabelMap, metrics } = layout;
  const { valueAxis: resolvedValueAxis, metricInsertIndex } =
    layout.pivotProgram;
  const { metricKeys: metricLabels } = layout.pivotProgram;

  const normalizedRowSubtotalLevels = layout.rowSubtotalLevels;
  const normalizedColSubtotalLevels = useMemo(() => {
    if (layout.rowTotals && !layout.colSubtotalLevels.includes(0)) {
      return [0, ...layout.colSubtotalLevels];
    }
    return layout.colSubtotalLevels;
  }, [layout.colSubtotalLevels, layout.rowTotals]);

  const expansionSemanticSignature = useMemo(
    () =>
      JSON.stringify({
        metrics: metricLabels,
        valueAxis: resolvedValueAxis,
        metricPosition: metricLabels.length > 0 ? metricInsertIndex : -1,
        rowSubtotalLevels: normalizedRowSubtotalLevels,
        colSubtotalLevels: normalizedColSubtotalLevels,
        rowTotals: layout.rowTotals,
        colTotals: layout.colTotals,
        rowSubTotals: layout.rowSubTotals,
        axisCoverageNeeds: layout.axisCoverageNeeds,
        measureHierarchy: layout.measureHierarchy,
      }),
    [
      layout.axisCoverageNeeds,
      layout.measureHierarchy,
      layout.colTotals,
      layout.rowSubTotals,
      layout.rowTotals,
      metricInsertIndex,
      metricLabels,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedValueAxis,
    ],
  );

  const resolvedRowSubtotalPosition = layout.rowSubtotalPosition;
  const resolvedColSubtotalPosition = layout.colSubtotalPosition;

  const {
    forceRowSubtotalEnd,
    effectiveRowSubtotalPosition,
    effectiveColSubtotalPosition,
  } = useMemo(
    () =>
      resolveMetricAxisLayoutPolicy({
        program: layout.pivotProgram,
        rowSubTotals: layout.rowSubTotals,
        resolvedRowSubtotalPosition,
        resolvedColSubtotalPosition,
      }),
    [
      layout.pivotProgram,
      layout.rowSubTotals,
      resolvedColSubtotalPosition,
      resolvedRowSubtotalPosition,
    ],
  );

  const getMetricDisplayLabelForKey = useCallback(
    (metricKey: string) =>
      resolveMetricDisplayLabel(metricKey, {
        metricLabelMap,
        verboseMap: formData.verboseMap as Record<string, string> | undefined,
        metrics,
      }),
    [formData.verboseMap, metricLabelMap, metrics],
  );

  const compareMetricOrder = useMemo(
    () =>
      buildMetricOrderComparator({
        program: layout.pivotProgram,
        measureHierarchy: layout.measureHierarchy,
      }),
    [layout.measureHierarchy, layout.pivotProgram],
  );

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricKeySet = new Set(layout.pivotProgram.metricKeys);
      const metricIndex = node.path.findIndex(val => {
        const decoded = decodeMetricKey(val);
        return decoded !== undefined && metricKeySet.has(decoded);
      });
      return metricIndex >= 0 && node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [forceRowSubtotalEnd, layout.pivotProgram, resolvedRowSubtotalPosition],
  );

  return {
    layout,
    expansionSemanticSignature,
    normalizedColSubtotalLevels,
    effectiveRowSubtotalPosition,
    effectiveColSubtotalPosition,
    compareMetricOrder,
    getMetricDisplayLabelForKey,
    getRowSubtotalPosition,
  };
};
