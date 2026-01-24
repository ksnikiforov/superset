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
import { type PivotTableQueryFormData } from '../../types';
import { type QuerySpec } from '../query/types';

export type TruncationWarning = {
  type: 'truncation';
  queryName?: string;
  rowcount?: number;
  rowLimit?: number;
};

export type ChartDataWarning = TruncationWarning;

export type ChartDataQueryResult = {
  data?: Record<string, unknown>[];
  query?: { query_name?: string };
  query_name?: string;
  rowcount?: number;
  warnings?: ChartDataWarning[];
};

export type ChartDataFetchParams = {
  formData: PivotTableQueryFormData;
  specs: QuerySpec[];
  requestGroupId?: string;
  signal?: AbortSignal;
};

export interface ChartDataClient {
  fetch(params: ChartDataFetchParams): Promise<ChartDataQueryResult[]>;
  cancel(requestGroupId: string): void;
}
