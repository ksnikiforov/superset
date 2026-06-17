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
/* eslint-disable import/no-extraneous-dependencies */
import { SupersetClient } from '@superset-ui/core';
import { render as baseRender } from 'spec/helpers/testing-library';
import { clearDatasetVerboseMapCache } from '../src/pivot/chart/useDatasetVerboseMap';

type BaseRender = typeof baseRender;
type RenderOptions = Parameters<BaseRender>[1];

export * from 'spec/helpers/testing-library';

export const render: BaseRender = (ui, options?: RenderOptions) =>
  baseRender(ui, { ...options, useDnd: options?.useDnd ?? true });

export const mockDatasetVerboseMap = (
  verboseMap: Record<string, string> = {},
) => {
  clearDatasetVerboseMapCache();
  const response = {
    json: {
      result: {
        columns: [],
        verbose_map: verboseMap,
      },
    },
  } as unknown as Awaited<ReturnType<typeof SupersetClient.get>>;
  return jest.spyOn(SupersetClient, 'get').mockResolvedValue(response);
};
