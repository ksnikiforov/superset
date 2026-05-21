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
  applyDimensionFilterSelectionChange,
  buildCellFilters,
  buildClearSelectedFiltersUpdate,
  buildRuntimeSelectionSyncState,
  buildTreeDimensionFilterValues,
  firstSelectedFilters,
  hasSelectedFilters,
  normalizePivotSelectedFilters,
} from '../../../src/pivot/filters';
import { MetricsLayoutEnum, PivotTreeNode } from '../../../src/types';
import {
  encodeMetricKey,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';

const testProgram = ({
  groupbyRows,
  groupbyColumns,
  metrics,
  metricsLayout,
}: {
  groupbyRows: string[];
  groupbyColumns: string[];
  metrics: string[];
  metricsLayout: MetricsLayoutEnum;
}) =>
  compilePivotProgram({
    groupbyRows,
    groupbyColumns,
    metrics,
    metricsLayout,
  });

describe('buildCellFilters', () => {
  it('builds filters for all row/col levels excluding metric tokens on columns', () => {
    const rowNode = {
      path: ['US', 'CA'],
    } as PivotTreeNode;
    const colNode = {
      path: [encodeMetricKey('metric1'), '2020', 'Q1'],
    } as PivotTreeNode;

    const filters = buildCellFilters({
      rowNode,
      colNode,
      program: testProgram({
        groupbyRows: ['country', 'state'],
        groupbyColumns: ['year', 'quarter'],
        metrics: ['metric1', 'metric2'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      }),
    });

    expect(filters).toEqual([
      { col: 'country', op: '==', val: 'US' },
      { col: 'state', op: '==', val: 'CA' },
      { col: 'year', op: '==', val: '2020' },
      { col: 'quarter', op: '==', val: 'Q1' },
    ]);
  });

  it('builds filters for all row/col levels excluding metric tokens on rows', () => {
    const rowNode = {
      path: [encodeMetricKey('metric2'), 'US', 'CA'],
    } as PivotTreeNode;
    const colNode = {
      path: ['2021'],
    } as PivotTreeNode;

    const filters = buildCellFilters({
      rowNode,
      colNode,
      program: testProgram({
        groupbyRows: ['country', 'state'],
        groupbyColumns: ['year'],
        metrics: ['metric1', 'metric2'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
    });

    expect(filters).toEqual([
      { col: 'country', op: '==', val: 'US' },
      { col: 'state', op: '==', val: 'CA' },
      { col: 'year', op: '==', val: '2021' },
    ]);
  });

  it('ignores subtotal tokens when building filters', () => {
    const rowNode = {
      path: ['US', SUBTOTAL_TOKEN],
    } as PivotTreeNode;
    const colNode = {
      path: ['2022'],
    } as PivotTreeNode;

    const filters = buildCellFilters({
      rowNode,
      colNode,
      program: testProgram({
        groupbyRows: ['country', 'state'],
        groupbyColumns: ['year'],
        metrics: ['metric1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      }),
    });

    expect(filters).toEqual([
      { col: 'country', op: '==', val: 'US' },
      { col: 'year', op: '==', val: '2022' },
    ]);
  });
});

describe('selected filter state helpers', () => {
  it('detects and selects the first populated filter source', () => {
    const selected = { country: ['France'] };

    expect(hasSelectedFilters({})).toBe(false);
    expect(hasSelectedFilters(selected)).toBe(true);
    expect(firstSelectedFilters({}, selected, { country: ['Germany'] })).toBe(
      selected,
    );
    expect(firstSelectedFilters({}, {})).toEqual({});
  });

  it('normalizes persisted filters to canonical dimension keys', () => {
    expect(
      normalizePivotSelectedFilters({
        filters: {
          Country: ['France'],
          region: ['EU'],
          Unknown: ['ignored'],
        },
        dimensions: [
          'Country',
          { expressionType: 'SQL', label: 'Region', sqlExpression: 'region' },
        ],
      }),
    ).toEqual({
      Country: ['France'],
      region: ['EU'],
    });
    expect(
      normalizePivotSelectedFilters({
        dimensions: ['Country'],
      }),
    ).toEqual({});
  });

  it('resolves runtime selection sync precedence for user-controlled charts', () => {
    expect(
      buildRuntimeSelectionSyncState({
        dimensions: [
          'Country',
          { expressionType: 'SQL', label: 'Region', sqlExpression: 'region' },
        ],
        selectedFiltersFromFormData: { Country: ['France'] },
        selectedFiltersFromOwnState: { region: ['EU'] },
        selectedFiltersFromProps: { Country: ['Germany'] },
        committedFilters: { Country: ['Spain'] },
      }),
    ).toEqual({
      selectedFiltersForTreeSync: { Country: ['France'] },
      persistedInteractionFilters: { Country: ['France'] },
      persistedSelectedFilters: { Country: ['France'] },
    });
  });

  it('uses committed filters before prop filters when persisted filters are empty', () => {
    expect(
      buildRuntimeSelectionSyncState({
        dimensions: ['Country'],
        selectedFiltersFromFormData: {},
        selectedFiltersFromOwnState: {},
        selectedFiltersFromProps: { Country: ['Germany'] },
        committedFilters: { Country: ['Spain'] },
      }),
    ).toEqual({
      selectedFiltersForTreeSync: { Country: ['Germany'] },
      persistedInteractionFilters: {},
      persistedSelectedFilters: { Country: ['Spain'] },
    });
  });

  it('collects tree filter values by canonical dimension keys', () => {
    const rows = {
      countryFrance: {
        key: 'countryFrance',
        path: ['France'],
      } as PivotTreeNode,
      subtotal: {
        key: 'subtotal',
        path: [SUBTOTAL_TOKEN],
        isSubtotal: true,
      } as PivotTreeNode,
    };
    const cols = {
      regionEu: {
        key: 'regionEu',
        path: [encodeMetricKey('metric1'), 'EU'],
      } as PivotTreeNode,
    };

    expect(
      buildTreeDimensionFilterValues({
        dimensions: [
          'country',
          { expressionType: 'SQL', label: 'Region', sqlExpression: 'region' },
        ],
        rows,
        cols,
        program: testProgram({
          groupbyRows: ['country'],
          groupbyColumns: ['region'],
          metrics: ['metric1'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
        }),
      }),
    ).toEqual({
      country: ['France'],
      region: ['EU'],
    });
  });

  it('updates dimension filter selections and stale restore suppression', () => {
    expect(
      applyDimensionFilterSelectionChange({
        selection: {},
        dimensionKey: 'country',
        values: ['France'],
      }),
    ).toEqual({
      selection: { country: ['France'] },
      suppressStalePersistedFilterRestore: false,
    });

    expect(
      applyDimensionFilterSelectionChange({
        selection: { country: ['France'], region: ['EU'] },
        dimensionKey: 'country',
        values: [],
      }),
    ).toEqual({
      selection: { region: ['EU'] },
      suppressStalePersistedFilterRestore: false,
    });

    expect(
      applyDimensionFilterSelectionChange({
        selection: { country: ['France'] },
        dimensionKey: 'country',
        values: [],
      }),
    ).toEqual({
      selection: {},
      suppressStalePersistedFilterRestore: true,
    });
  });

  it('builds clear-all filter updates only when filters exist', () => {
    expect(buildClearSelectedFiltersUpdate({})).toBeNull();
    expect(buildClearSelectedFiltersUpdate({ country: ['France'] })).toEqual({
      selection: {},
      suppressStalePersistedFilterRestore: true,
    });
  });
});
