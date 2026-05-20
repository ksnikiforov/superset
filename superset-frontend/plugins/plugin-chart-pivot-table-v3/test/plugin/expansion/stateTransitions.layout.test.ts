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

import { resolveLayoutTransition } from '../../../src/pivot/expansion/stateTransitions';

const baseTransitionConfig = {
  currentLayout: { rows: ['country'], cols: [] },
  previousLayout: { rows: ['country'], cols: [] },
};

describe('pivot/expansion/stateTransitions layout changes', () => {
  it('reports unchanged row and column layouts', () => {
    expect(resolveLayoutTransition(baseTransitionConfig)).toMatchObject({
      rowsChanged: false,
      colsChanged: false,
      shouldExpandRows: false,
      shouldExpandCols: false,
      rowStablePrefix: 1,
      colStablePrefix: 0,
    });
  });

  it('reports trailing row appends as expansion-compatible changes', () => {
    expect(
      resolveLayoutTransition({
        ...baseTransitionConfig,
        previousLayout: { rows: ['country'], cols: [] },
        currentLayout: { rows: ['country', 'state'], cols: [] },
      }),
    ).toMatchObject({
      rowsChanged: true,
      colsChanged: false,
      shouldExpandRows: true,
      shouldExpandCols: false,
      rowStablePrefix: 1,
    });
  });

  it('reports trailing row trims without treating them as expansion appends', () => {
    expect(
      resolveLayoutTransition({
        ...baseTransitionConfig,
        previousLayout: { rows: ['country', 'state', 'city'], cols: [] },
        currentLayout: { rows: ['country', 'state'], cols: [] },
      }),
    ).toMatchObject({
      rowsChanged: true,
      shouldExpandRows: false,
      rowStablePrefix: 2,
    });
  });

  it('uses the same stable-prefix policy for columns', () => {
    expect(
      resolveLayoutTransition({
        previousLayout: { rows: [], cols: ['year', 'quarter'] },
        currentLayout: { rows: [], cols: ['year', 'month'] },
      }),
    ).toMatchObject({
      rowsChanged: false,
      colsChanged: true,
      shouldExpandCols: false,
      colStablePrefix: 1,
    });
  });
});
