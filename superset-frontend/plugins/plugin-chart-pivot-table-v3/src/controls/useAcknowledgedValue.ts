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
import { useCallback, useEffect, useRef, useState } from 'react';
import { isEqual } from 'lodash';

/** Keeps local edits until the control's persisted value acknowledges them. */
export function useAcknowledgedValue<T>(persisted: T) {
  const [value, setValue] = useState(persisted);
  const state = useRef({ value: persisted, pending: false });
  useEffect(() => {
    if (state.current.pending && !isEqual(persisted, state.current.value))
      return;
    state.current = { value: persisted, pending: false };
    setValue(current => (isEqual(current, persisted) ? current : persisted));
  }, [persisted]);
  const update = useCallback((next: T) => {
    state.current = { value: next, pending: true };
    setValue(next);
  }, []);
  const read = useCallback(() => state.current.value, []);
  return [value, update, read] as const;
}
