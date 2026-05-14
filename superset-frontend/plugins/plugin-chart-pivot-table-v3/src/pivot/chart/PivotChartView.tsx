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
import { PivotTableView } from '../render/PivotTableView';
import {
  PivotInteractionLayout,
  type PivotInteractionLayoutProps,
} from './PivotInteractionLayout';
import {
  PivotInteractionPanel,
  type PivotInteractionPanelProps,
} from './PivotInteractionPanel';
import { type SharedPivotViewProps } from './pivotViewProps';

type PivotChartViewProps = {
  isUserControlled: boolean;
  height: number;
  width: number;
  tableHeight: number;
  tableWidth: number;
  isHydrating: boolean;
  sharedPivotViewProps: SharedPivotViewProps;
  interactionLayoutProps: Omit<
    PivotInteractionLayoutProps,
    'height' | 'tableHeight' | 'tableWidth' | 'panel' | 'children'
  >;
  interactionPanelProps: PivotInteractionPanelProps;
};

export const PivotChartView = ({
  isUserControlled,
  height,
  width,
  tableHeight,
  tableWidth,
  isHydrating,
  sharedPivotViewProps,
  interactionLayoutProps,
  interactionPanelProps,
}: PivotChartViewProps) =>
  isUserControlled ? (
    <PivotInteractionLayout
      height={height}
      tableHeight={tableHeight}
      tableWidth={tableWidth}
      panel={<PivotInteractionPanel {...interactionPanelProps} />}
      {...interactionLayoutProps}
    >
      <PivotTableView
        {...sharedPivotViewProps}
        height={tableHeight}
        width={tableWidth}
      />
    </PivotInteractionLayout>
  ) : (
    <PivotTableView
      {...sharedPivotViewProps}
      height={height}
      width={width}
      showGlobalLoader={isHydrating}
      showCornerLoader={isHydrating}
    />
  );
