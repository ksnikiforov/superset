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
import { METRICS_PLACEHOLDER } from '../../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  buildExpansionFactCoverage,
  buildVisibleFactCoverage,
} from '../../../../src/pivot/runtime/coverage';
import { MetricsLayoutEnum } from '../../../../src/types';

describe('visible fact coverage', () => {
  it('does not request coverage for a non-only hidden row layer', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', 'state'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildVisibleFactCoverage({
      program,
      rowDepth: 1,
      columnDepth: 0,
      reason: 'layout',
    });

    expect(coverage).toEqual([
      {
        reason: 'layout',
        rowDepth: 1,
        columnDepth: 0,
        rowDimensions: ['country'],
        columnDimensions: [],
      },
    ]);
  });

  it('does not request coverage for a non-only hidden column layer', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['category', 'subcategory'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    const coverage = buildVisibleFactCoverage({
      program,
      rowDepth: 0,
      columnDepth: 1,
      reason: 'layout',
    });

    expect(coverage[0].columnDimensions).toEqual(['category']);
    expect(coverage[0].columnDepth).toBe(1);
  });

  it('may request coverage for the first and only visible row layer', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildVisibleFactCoverage({
      program,
      rowDepth: 1,
      columnDepth: 0,
    });

    expect(coverage[0].rowDimensions).toEqual(['country']);
  });

  it('does not request DB coverage when expansion only reveals Values', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildExpansionFactCoverage({
      program,
      axis: 'row',
      expandedAxisLevelIndex: 0,
      currentRowDepth: 1,
      currentColumnDepth: 0,
    });

    expect(coverage).toEqual([]);
  });

  it('requests only the newly visible dimension after Values expansion', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildExpansionFactCoverage({
      program,
      axis: 'row',
      expandedAxisLevelIndex: 1,
      currentRowDepth: 1,
      currentColumnDepth: 0,
    });

    expect(coverage).toEqual([
      {
        reason: 'expand',
        rowDepth: 2,
        columnDepth: 0,
        rowDimensions: ['country', 'state'],
        columnDimensions: [],
      },
    ]);
  });

  it('does not request DB coverage when root expansion reveals Values first', () => {
    const program = compilePivotProgram({
      groupbyColumns: [METRICS_PLACEHOLDER, 'month'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    const coverage = buildExpansionFactCoverage({
      program,
      axis: 'col',
      expandedAxisLevelIndex: -1,
      currentRowDepth: 0,
      currentColumnDepth: 0,
    });

    expect(coverage).toEqual([]);
  });
});
