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
import { useCallback } from 'react';
import { useAcknowledgedValue } from './useAcknowledgedValue';

/** Keeps local edits and persisted settings together, including consecutive field updates. */
export function useControlMap<Value extends object>(
  name: string,
  persisted: Record<string, Value>,
  save?: (name: string, value: Record<string, Value>) => void,
) {
  const [value, setValue, read] = useAcknowledgedValue(persisted);
  const replace = useCallback(
    (next: Record<string, Value>) => {
      if (!save) return;
      setValue(next);
      save(name, next);
    },
    [name, save, setValue],
  );
  const update = useCallback(
    (key: string, change: (entry: Value | undefined) => Value | undefined) => {
      if (!key || !save) return;
      const current = read();
      const next = { ...current };
      const entry = change(current[key]);
      if (entry) next[key] = entry;
      else delete next[key];
      replace(next);
    },
    [read, replace, save],
  );
  return { value, read, replace, update };
}
