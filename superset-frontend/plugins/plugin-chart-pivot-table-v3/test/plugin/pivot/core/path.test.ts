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
  parsePath,
  CELL_KEY_DIVIDER,
  PATH_DIVIDER,
  serializeCellKey,
  serializePath,
} from '../../../../src/pivot/core/path';

describe('pivot/core/path', () => {
  test('round-trips divider-containing strings', () => {
    const dividerValue = `A${PATH_DIVIDER}B`;
    const key = serializePath([dividerValue]);
    expect(parsePath(`A${PATH_DIVIDER}${PATH_DIVIDER}B`)).toEqual([
      dividerValue,
    ]);
    expect(parsePath(key)).toEqual([dividerValue]);
  });

  test('round-trips null and undefined values', () => {
    expect(parsePath(serializePath([null]))).toEqual([null]);
    expect(parsePath(serializePath([undefined]))).toEqual([undefined]);
  });

  test('serializes cell keys', () => {
    expect(serializeCellKey('rowKey', 'colKey')).toBe(
      `rowKey${CELL_KEY_DIVIDER}colKey`,
    );
  });
});

test.each([
  [[], ['']],
  [[null], ['__NULL__']],
  [[undefined], ['__UNDEFINED__']],
  [[1], ['1']],
  [[true], ['true']],
  [['A', '', 'B'], [`A${PATH_DIVIDER}B`]],
  [
    ['A', `${PATH_DIVIDER}B`],
    [`A${PATH_DIVIDER}`, 'B'],
  ],
])('keeps distinct categories distinct: %j and %j', (left, right) => {
  expect(serializePath(left)).not.toBe(serializePath(right));
});

test.each([
  [''],
  ['A', '', 'B'],
  [null, undefined, 1, true],
  ['__NULL__', '__UNDEFINED__'],
  ['__proto__'],
  ['constructor'],
  [`A${CELL_KEY_DIVIDER}B`],
  [new Date('2026-01-01'), BigInt(12)],
])('round-trips typed path %j', (...path) => {
  expect(parsePath(serializePath(path))).toEqual(path);
});

test('does not alias cell keys containing cell delimiters', () => {
  expect(serializeCellKey(`A${CELL_KEY_DIVIDER}B`, 'C')).not.toBe(
    serializeCellKey('A', `B${CELL_KEY_DIVIDER}C`),
  );
});
