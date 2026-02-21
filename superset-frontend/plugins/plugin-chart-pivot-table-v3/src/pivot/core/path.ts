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
import { PivotPath } from '../../types';

export const PATH_DIVIDER = '\u0000';
export const CELL_KEY_DIVIDER = '\u0001';

const escapePathDivider = (value: string) =>
  value.split(PATH_DIVIDER).join(`${PATH_DIVIDER}${PATH_DIVIDER}`);

const serializePathValue = (value: PivotPath[number]) => {
  if (value === null) {
    return '__NULL__';
  }
  if (value === undefined) {
    return '__UNDEFINED__';
  }
  return escapePathDivider(String(value));
};

export const serializePath = (path: PivotPath = []) =>
  path.map(serializePathValue).join(PATH_DIVIDER);

const deserializePathValue = (value: string): PivotPath[number] => {
  if (value === '__NULL__') {
    return null;
  }
  if (value === '__UNDEFINED__') {
    return undefined;
  }
  return value;
};

export const parsePath = (key: string): PivotPath => {
  if (!key) {
    return [];
  }
  const parts: string[] = [];
  let buffer = '';
  for (let idx = 0; idx < key.length; idx += 1) {
    const char = key[idx];
    if (char !== PATH_DIVIDER) {
      buffer += char;
      continue;
    }
    const nextChar = key[idx + 1];
    if (nextChar === PATH_DIVIDER) {
      buffer += PATH_DIVIDER;
      idx += 1;
      continue;
    }
    parts.push(buffer);
    buffer = '';
  }
  parts.push(buffer);
  return parts.map(deserializePathValue);
};

export const serializeCellKey = (rowKey: string, colKey: string) =>
  `${rowKey}${CELL_KEY_DIVIDER}${colKey}`;

export type ParsedCellKey = { rowKey: string; colKey: string };

export const parseCellKey = (key: string): ParsedCellKey => {
  const dividerIndex = key.indexOf(CELL_KEY_DIVIDER);
  if (dividerIndex < 0) {
    return { rowKey: key, colKey: '' };
  }
  return {
    rowKey: key.slice(0, dividerIndex),
    colKey: key.slice(dividerIndex + CELL_KEY_DIVIDER.length),
  };
};
