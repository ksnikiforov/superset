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
import { QueryFormColumn } from '@superset-ui/core';
import {
  decodeMetricKey,
  decodeMeasureLeafId,
  encodeMetricKey,
  encodeMeasureLeafKey,
  isMetricToken,
  isMeasureLeafToken,
  isMetricsPlaceholder,
  METRICS_PLACEHOLDER,
  normalizePlaceholder,
} from '../../../../src/pivot/core/tokens';

describe('pivot/core/tokens', () => {
  it('encodes and decodes metric tokens', () => {
    const encoded = encodeMetricKey('metric1');
    expect(isMetricToken(encoded)).toBe(true);
    expect(decodeMetricKey(encoded)).toBe('metric1');
    expect(decodeMetricKey('not-a-token')).toBeUndefined();
  });

  it('encodes and decodes measure leaf tokens', () => {
    const encoded = encodeMeasureLeafKey('leaf1');
    expect(isMeasureLeafToken(encoded)).toBe(true);
    expect(decodeMeasureLeafId(encoded)).toBe('leaf1');
    expect(decodeMeasureLeafId('not-a-token')).toBeUndefined();
  });

  it('normalizes metrics placeholder from object columns', () => {
    const placeholderObj = {
      column_name: METRICS_PLACEHOLDER,
    } as unknown as QueryFormColumn;
    expect(normalizePlaceholder(placeholderObj)).toBe(METRICS_PLACEHOLDER);
    expect(isMetricsPlaceholder(placeholderObj)).toBe(true);
  });
});
