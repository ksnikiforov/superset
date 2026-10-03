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
import { type PivotPath, type PivotPathValue } from '../../types';

export const PATH_DIVIDER = '\u0000';
export const CELL_KEY_DIVIDER = '\u0001';
const TYPED_PATH_PREFIX = '\u0003';

type EncodedValue = [string, string];

const encodeValue = (value: PivotPathValue): EncodedValue => {
  if (value === null) return ['null', ''];
  if (value === undefined) return ['undefined', ''];
  if (value instanceof Date) return ['date', String(value.getTime())];
  return [typeof value, Object.is(value, -0) ? '-0' : String(value)];
};

const decodeValue = ([type, value]: EncodedValue): PivotPathValue => {
  switch (type) {
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'number':
      return Number(value);
    case 'bigint':
      return BigInt(value);
    case 'boolean':
      return value === 'true';
    case 'date':
      return new Date(Number(value));
    default:
      return value;
  }
};

/** Encode identity without conflating types, empty values, or separators. */
export const serializePath = (path: PivotPath = []): string => {
  if (path.length === 0) return '';
  const canUseLegacyKey = path.every(
    value =>
      typeof value === 'string' &&
      value.length > 0 &&
      !/[\u0000\u0001\u0003]/.test(value) &&
      value !== '__NULL__' &&
      value !== '__UNDEFINED__' &&
      !Object.prototype.hasOwnProperty.call(Object.prototype, value),
  );
  return canUseLegacyKey
    ? path.join(PATH_DIVIDER)
    : `${TYPED_PATH_PREFIX}${JSON.stringify(path.map(encodeValue))}`;
};

/** Decode typed keys and legacy keys saved by earlier plugin versions. */
export const parsePath = (key: string): PivotPath => {
  if (!key) return [];
  if (key.startsWith(TYPED_PATH_PREFIX)) {
    const encoded: EncodedValue[] = JSON.parse(key.slice(1));
    return encoded.map(decodeValue);
  }
  const parts: string[] = [];
  let buffer = '';
  for (let idx = 0; idx < key.length; idx += 1) {
    const char = key[idx];
    if (char !== PATH_DIVIDER) {
      buffer += char;
      continue;
    }
    if (key[idx + 1] === PATH_DIVIDER) {
      buffer += PATH_DIVIDER;
      idx += 1;
      continue;
    }
    parts.push(buffer);
    buffer = '';
  }
  parts.push(buffer);
  return parts.map(value =>
    value === '__NULL__' ? null : value === '__UNDEFINED__' ? undefined : value,
  );
};

/** Keep row/column boundaries unambiguous even for legacy keys. */
export const serializeCellKey = (rowKey: string, colKey: string): string =>
  rowKey.includes(CELL_KEY_DIVIDER) || colKey.includes(CELL_KEY_DIVIDER)
    ? `${TYPED_PATH_PREFIX}${JSON.stringify([rowKey, colKey])}`
    : `${rowKey}${CELL_KEY_DIVIDER}${colKey}`;
