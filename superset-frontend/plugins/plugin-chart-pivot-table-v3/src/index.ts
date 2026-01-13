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
import { Behavior, ChartMetadata, ChartPlugin, t } from '@superset-ui/core';
import transformProps from './transformProps';
import controlPanel from './controlPanel';
import buildQuery from './buildQuery';
import thumbnail from './images/thumbnail.png';
import { PivotTableProps, PivotTableQueryFormData } from './types';

export * from './types';

const metadata = new ChartMetadata({
  behaviors: [
    Behavior.InteractiveChart,
    Behavior.DrillToDetail,
    Behavior.DrillBy,
  ],
  category: t('Table'),
  description: t(
    'Pivot table with lazy branch loading and database-accurate totals/subtotals.',
  ),
  name: t('Pivot Table v3'),
  tags: [t('Additive'), t('Business'), t('Featured'), t('Report'), t('Pivot')],
  thumbnail,
});

export default class PivotTableV3ChartPlugin extends ChartPlugin<
  PivotTableQueryFormData,
  PivotTableProps
> {
  constructor() {
    super({
      loadChart: () => import('./PivotTableChart'),
      metadata,
      // Casting because the chart consumes a richer prop shape than the base ChartProps type captures.
      transformProps: transformProps as any,
      controlPanel,
      buildQuery,
    });
  }
}
