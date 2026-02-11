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

const ymdPattern = /^\d{4}-\d{2}-\d{2}$/;
const yearPattern = /^\d{4}$/;
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
const assertTemporalTokenPattern = (
  token: string | null,
  pattern: RegExp,
  label: string,
) => {
  expect(token, `${label} token is missing`).to.not.eq(null);
  expect(token as string, `${label} has unexpected format`).to.match(pattern);
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

const PIVOT_TABLE_V3_FORM_DATA = {
  datasource: '3__table',
  viz_type: 'pivot_table_v3',
  granularity_sqla: 'ds',
  time_range: '100 years ago : now',
  metrics: ['sum__num'],
  adhoc_filters: [],
  groupbyRows: [ORDER_YEAR, ORDER_MONTH, 'name'],
  groupbyColumns: [],
  metricsLayout: 'COLUMNS',
  rowTotals: true,
  colTotals: true,
  startCollapsed: true,
  initialDepth: 1,
};

const runTemporalExpandAssertions = (
  formData: Record<string, unknown>,
  expectedYearPattern: RegExp,
  expectedMonthPattern: RegExp,
) => {
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
  }).as('chartData');
  cy.visitChartByParams(formData);
  cy.verifySliceSuccess({ waitAlias: '@chartData', chartSelector: 'table' });

  cy.get('.chart-container [aria-label="plus-square"]', { timeout: 60000 })
    .first()
    .should('be.visible')
    .closest('tr')
    .then($parentRow => {
      const parentIndex = $parentRow.index();
      const rowsBefore = Cypress.$('.chart-container table tbody tr').length;

      cy.wrap($parentRow)
        .find('[aria-label="plus-square"]')
        .first()
        .click({ force: true });

      cy.get('.chart-container table tbody tr', { timeout: 15000 })
        .should($rowsAfter => {
          expect($rowsAfter.length).to.be.greaterThan(rowsBefore);
        })
        .then($rowsAfter => {
          cy.wrap(null, { timeout: 15000 }).should(() => {
            expect(successfulBranchFetches).to.be.greaterThan(0);
          });

          const secondValueRow = Cypress.$($rowsAfter.get(parentIndex + 1));
          expect(secondValueRow.length, 'missing second-level row').to.eq(1);

          const rowsAfterFirstExpansion = $rowsAfter.length;
          cy.get('.chart-container table tbody tr')
            .eq(parentIndex + 1)
            .within(() => {
              cy.get('[aria-label="plus-square"]', { timeout: 15000 })
                .should('be.visible')
                .first()
                .click({ force: true });
            });

          cy.get('.chart-container table tbody tr', { timeout: 15000 }).should(
            $rowsAfterSecondExpansion => {
              expect($rowsAfterSecondExpansion.length).to.be.greaterThan(
                rowsAfterFirstExpansion,
              );
              const thirdLevelRow = Cypress.$(
                $rowsAfterSecondExpansion.get(parentIndex + 2),
              );
              expect(thirdLevelRow.length, 'missing third-level row').to.eq(1);
              const thirdLevelText = thirdLevelRow.find('th,td').first().text();
              expect(
                normalizeCellText(thirdLevelText).trim(),
                'third-level row is empty after second expansion',
              ).to.not.eq('');
            },
          );
          cy.wrap(null, { timeout: 15000 }).should(() => {
            expect(successfulBranchFetches).to.be.greaterThan(1);
          });
          cy.get('.chart-container table tbody tr')
            .eq(parentIndex + 1)
            .find('[aria-label="minus-square"]', { timeout: 15000 })
            .should('exist');

          cy.get('.chart-container table tbody tr')
            .eq(parentIndex)
            .find('th,td')
            .first()
            .invoke('text')
            .then(parentCellText => {
              expect(
                normalizeCellText(parentCellText).trim(),
                'year-level UI cell is empty after expansions',
              ).to.not.eq('');
              const yearToken = extractTemporalToken(parentCellText);
              assertTemporalTokenPattern(
                yearToken,
                expectedYearPattern,
                'Year-level UI value',
              );
            });

          cy.get('.chart-container table tbody tr')
            .eq(parentIndex + 1)
            .find('th,td')
            .first()
            .invoke('text')
            .then(secondValueCellText => {
              expect(
                normalizeCellText(secondValueCellText).trim(),
                'month-level UI cell is empty after expansions',
              ).to.not.eq('');
              const monthToken = extractTemporalToken(secondValueCellText);
              assertTemporalTokenPattern(
                monthToken,
                expectedMonthPattern,
                'Month-level UI value',
              );
            });
        });
    });

  cy.contains('Error loading Pivot Table').should('not.exist');
  cy.contains('[object Response]').should('not.exist');
};

describe('Visualization > Pivot Table v3', () => {
  it('uses default YYYY-MM-DD formatting for adhoc DATE_TRUNC hierarchy', () => {
    runTemporalExpandAssertions(PIVOT_TABLE_V3_FORM_DATA, ymdPattern, ymdPattern);
  });

  it('uses explicitly configured date format when provided', () => {
    runTemporalExpandAssertions(
      {
        ...PIVOT_TABLE_V3_FORM_DATA,
        dateFormat: '%Y',
      },
      yearPattern,
      yearPattern,
    );
  });
});
