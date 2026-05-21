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
import { useTheme } from '@apache-superset/core/theme';
import { useCallback, useMemo } from 'react';
import { Metric } from '@superset-ui/core';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  MeasureLeafSpec,
  PivotMetricDatabar,
  PivotMetricDatabarMap,
  PivotMetricFormatting,
  PivotMetricFormattingMap,
  PivotMetricFormattingValue,
} from '../../types';
import {
  buildMeasureLeafOutputKey,
  isValueLeaf,
} from '../../pivot/measureLeaves';
import OptionControlLabel from './OptionControlLabel';
import {
  MetricFormattingControl,
  type MetricOptionValue,
} from './PivotMetricDefinitionValue';

export type MeasureLeafValueProps = {
  metricLabel: string;
  metricKey: string;
  leaf: MeasureLeafSpec;
  index: number;
  onRemoveLeaf: (index: number) => void;
  onMoveLeaf: (dragIndex: number, hoverIndex: number) => void;
  onDropLeaf: () => void;
  metricFormatting: PivotMetricFormattingMap;
  onMetricFormattingChange: (
    metricKey: string,
    field: keyof PivotMetricFormatting,
    metric?: PivotMetricFormattingValue,
  ) => void;
  metricDatabars: PivotMetricDatabarMap;
  onMetricDatabarChange: (
    metricKey: string,
    field: keyof PivotMetricDatabar,
    value?: PivotMetricDatabar[keyof PivotMetricDatabar],
  ) => void;
  availableMetrics: MetricOptionValue[];
  selectedMetrics: MetricOptionValue[];
  metricLabelMap?: Record<string, string>;
  savedMetrics: Metric[];
  columns: ColumnMeta[];
  datasource?: React.ComponentProps<
    typeof import('../../exploreImports').AdhocMetricPopoverTrigger
  >['datasource'];
  type: string;
  removable?: boolean;
  isGroupDragging?: boolean;
};

export default function MeasureLeafValue({
  metricLabel,
  metricKey,
  leaf,
  index,
  onRemoveLeaf,
  onMoveLeaf,
  onDropLeaf,
  metricFormatting,
  onMetricFormattingChange,
  metricDatabars,
  onMetricDatabarChange,
  availableMetrics,
  selectedMetrics,
  metricLabelMap,
  savedMetrics,
  columns,
  datasource,
  type,
  removable = true,
  isGroupDragging = false,
}: MeasureLeafValueProps) {
  const theme = useTheme();
  const outputKey = useMemo(
    () => buildMeasureLeafOutputKey(metricKey, leaf),
    [leaf, metricKey],
  );
  const formatting = metricFormatting[outputKey] || {};
  const databar = metricDatabars[outputKey] || {};
  const isIxLeaf = leaf.kind === 'builtIn' && leaf.operator === 'ix';
  const handleFormattingChange = useCallback(
    (
      field: keyof PivotMetricFormatting,
      metric?: PivotMetricFormattingValue,
    ) => {
      onMetricFormattingChange(outputKey, field, metric);
    },
    [onMetricFormattingChange, outputKey],
  );
  const handleDatabarChange = useCallback(
    (
      field: keyof PivotMetricDatabar,
      value?: PivotMetricDatabar[keyof PivotMetricDatabar],
    ) => {
      onMetricDatabarChange(outputKey, field, value);
    },
    [onMetricDatabarChange, outputKey],
  );
  const formattingControl = (
    <MetricFormattingControl
      metricKey={outputKey}
      metricLabel={`${metricLabel} ${leaf.label}`.trim()}
      ariaLabel={`Add conditional formatting for ${leaf.label}`}
      excelOnly={isIxLeaf}
      formatting={formatting}
      databar={databar}
      metricDatabars={metricDatabars}
      availableMetrics={availableMetrics}
      selectedMetrics={selectedMetrics}
      metricLabelMap={metricLabelMap}
      columns={columns}
      savedMetrics={savedMetrics}
      datasource={datasource}
      onFormattingChange={handleFormattingChange}
      onDatabarChange={handleDatabarChange}
    />
  );

  const handleRemove = useCallback(
    () => onRemoveLeaf(index),
    [index, onRemoveLeaf],
  );
  const containerIndent = theme.sizeUnit * 2;

  return (
    <OptionControlLabel
      label={leaf.label}
      onRemove={handleRemove}
      onMoveLabel={onMoveLeaf}
      onDropLabel={onDropLeaf}
      withCaret={false}
      type={type}
      index={index}
      multi
      rightNode={formattingControl}
      containerIndent={containerIndent}
      showRemove={removable && !isValueLeaf(leaf)}
      isGroupDragging={isGroupDragging}
    />
  );
}
