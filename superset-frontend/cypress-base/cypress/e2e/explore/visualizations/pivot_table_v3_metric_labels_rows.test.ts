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

const yearPattern = /^\d{4}$/;
const METRICS_PLACEHOLDER = '__MEASURES__';

const normalizeCellText = (value: string): string => value.replace(/\u00a0/g, ' ');
const extractTemporalToken = (value: string): string | null => {
  const normalized = normalizeCellText(value);
  const isoOrDate =
    normalized.match(/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?/)?.[0] ??
    null;
  if (isoOrDate) {
    return isoOrDate;
  }
  const epochLike = normalized.match(/-?\d{11,}/)?.[0] ?? null;
  if (epochLike) {
    return epochLike;
  }
  return normalized.match(/\b\d{4}\b/)?.[0] ?? null;
};

const ORDER_YEAR = {
  expressionType: 'SQL' as const,
  sqlExpression: "DATE_TRUNC('year', ds)",
  label: 'orderYear',
};

const ORDER_MONTH = {
  expressionType: 'SQL' as const,
  sqlExpression: "DATE_TRUNC('month', ds)",
  label: 'orderMonth',
};

const PIVOT_TABLE_V3_YEAR_VALUES_ROWS_FORM_DATA = {
  datasource: '3__table',
  viz_type: 'pivot_table_v3',
  granularity_sqla: 'ds',
  time_range: '100 years ago : now',
  metrics: ['sum__num', 'count'],
  adhoc_filters: [],
  groupbyRows: [ORDER_YEAR, METRICS_PLACEHOLDER, ORDER_MONTH],
  groupbyColumns: [],
  metricsLayout: 'ROWS',
  rowTotals: true,
  colTotals: true,
  startCollapsed: true,
  initialDepth: 1,
  dateFormat: '%Y',
};

describe('Visualization > Pivot Table v3 > Metric labels', () => {
  it('keeps metric labels on rows when %Y is enabled', () => {
    let successfulBranchFetches = 0;
    cy.intercept('POST', '**/api/v1/chart/data', req => {
      const body = (req.body ?? {}) as {
        queries?: Array<{ query_name?: string }>;
      };
      const isBranch = (body.queries ?? []).some(
        query =>
          typeof query.query_name === 'string' &&
          query.query_name.includes('|branch:'),
      );
      if (isBranch) {
        req.on('response', response => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            successfulBranchFetches += 1;
          }
        });
      }
    }).as('chartDataRowsValues');

    cy.visitChartByParams(PIVOT_TABLE_V3_YEAR_VALUES_ROWS_FORM_DATA);
    cy.verifySliceSuccess({
      waitAlias: '@chartDataRowsValues',
      chartSelector: 'table',
    });

    cy.get('.chart-container table tbody tr', { timeout: 60000 }).then($rows => {
      let yearIndex = -1;
      $rows.each((index, row) => {
        const firstCellText = Cypress.$(row).find('th,td').first().text();
        const token = extractTemporalToken(firstCellText);
        if (token && yearPattern.test(token)) {
          yearIndex = index;
          return false;
        }
        return undefined;
      });
      expect(yearIndex, 'no year row found').to.be.greaterThan(-1);

      const yearRow = Cypress.$($rows.get(yearIndex));
      const hasPlus = yearRow.find('[aria-label="plus-square"]').length > 0;
      const rowsBefore = $rows.length;

      if (hasPlus) {
        cy.get('.chart-container table tbody tr')
          .eq(yearIndex)
          .find('[aria-label="plus-square"]')
          .first()
          .click({ force: true });

        cy.get('.chart-container table tbody tr', { timeout: 15000 }).should(
          $rowsAfterYearExpansion => {
            expect($rowsAfterYearExpansion.length).to.be.greaterThan(rowsBefore);
          },
        );
        cy.wrap(null, { timeout: 15000 }).should(() => {
          expect(successfulBranchFetches).to.be.greaterThan(0);
        });
      }

      cy.get('.chart-container table tbody tr')
        .eq(yearIndex + 1)
        .find('th,td')
        .first()
        .invoke('text')
        .then(metricRowText => {
          const normalizedMetricLabel = normalizeCellText(metricRowText).trim();
          expect(normalizedMetricLabel, 'metric row label is empty').to.not.eq('');
          expect(
            normalizedMetricLabel,
            'metric row should display metric name',
          ).to.match(/sum__num|count\(\*\)|count/i);
          const metricTemporalToken = extractTemporalToken(normalizedMetricLabel);
          expect(
            metricTemporalToken,
            'metric row label should not be temporal token',
          ).to.eq(null);
        });
    });

    cy.contains('Error loading Pivot Table').should('not.exist');
    cy.contains('[object Response]').should('not.exist');
  });
});
