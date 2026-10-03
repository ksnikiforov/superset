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
import { QueryData, VizType } from '@superset-ui/core';
import { render, screen, userEvent } from 'spec/helpers/testing-library';
import { ChartPills } from './ChartPills';

const renderPills = (vizType: string) =>
  render(
    <ChartPills
      queriesResponse={[{ rowcount: 10 } as QueryData]}
      rowLimit={10}
      formData={{ viz_type: vizType }}
      chartStatus="rendered"
      chartUpdateStartTime={0}
      chartUpdateEndTime={1}
      refreshCachedQuery={jest.fn()}
    />,
  );

test('Pivot Table v3 keeps the query count without a stale partial-data tooltip', async () => {
  renderPills(VizType.PivotTableV3);
  await userEvent.hover(screen.getByText('10 rows'));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('other charts keep the standard row-limit tooltip', async () => {
  renderPills(VizType.Table);
  await userEvent.hover(screen.getByText('10 rows'));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('The row limit');
});
