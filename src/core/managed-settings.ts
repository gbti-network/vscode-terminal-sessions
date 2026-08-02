/**
 * The snapshot of settings the column layout overrides, with no `vscode`.
 *
 * Two defects lived here and both were invisible in the source.
 *
 * A key the user had never set was recorded as `undefined`. Extension state
 * crosses to the host as JSON, and `JSON.stringify` drops properties whose value
 * is `undefined`, so the snapshot came back `{}` on the next activation. The
 * backfill then re-recorded the extension's *own* overrides as the user's
 * baseline, and Disable wrote them permanently into settings.json. The fix is to
 * record which keys were captured separately from their values, so "captured,
 * and it was unset" is a state JSON can carry.
 *
 * The second was scope. The snapshot lived in workspace state while the settings
 * it protects are written globally, so a second folder captured the first
 * folder's overrides. That is fixed by where this is stored, not here.
 */

/** What the user's settings looked like before the layout took them over. */
export interface SettingsSnapshot {
  /** Every managed key captured so far, including ones the user had not set. */
  keys: string[];
  /** Values for the subset the user had actually set. */
  values: Record<string, unknown>;
}

export function emptySnapshot(): SettingsSnapshot {
  return { keys: [], values: {} };
}

/**
 * Record any managed key not captured yet.
 *
 * Existing entries always win: by the time this runs again the current value is
 * likely to be this extension's own override, and capturing that would make
 * Disable restore the override instead of the user's choice. Safe to call
 * unconditionally, which is what lets a workspace already enabled pick up a key
 * first managed by a later version and still have it restored.
 */
export function captureSnapshot(
  existing: SettingsSnapshot | undefined,
  managedKeys: readonly string[],
  read: (key: string) => unknown,
): SettingsSnapshot {
  const snapshot: SettingsSnapshot = {
    keys: [...(existing?.keys ?? [])],
    values: { ...(existing?.values ?? {}) },
  };
  for (const key of managedKeys) {
    if (snapshot.keys.includes(key)) {
      continue;
    }
    snapshot.keys.push(key);
    const value = read(key);
    // Only set values are stored. An unset key is remembered by its presence in
    // `keys`, which survives serialization where `undefined` did not.
    if (value !== undefined) {
      snapshot.values[key] = value;
    }
  }
  return snapshot;
}

/** Whether a key was captured, whether or not it had a value. */
export function wasCaptured(snapshot: SettingsSnapshot | undefined, key: string): boolean {
  return (snapshot?.keys ?? []).includes(key);
}

/**
 * The writes that put the user's settings back.
 *
 * A key captured without a value is restored as `undefined`, which removes the
 * setting rather than pinning it to whatever this extension chose. That is the
 * difference between "you never set this" and "you set this to our default".
 */
export function restoreWrites(
  snapshot: SettingsSnapshot | undefined,
): Array<{ key: string; value: unknown }> {
  return (snapshot?.keys ?? []).map((key) => ({
    key,
    value: Object.prototype.hasOwnProperty.call(snapshot?.values ?? {}, key)
      ? snapshot!.values[key]
      : undefined,
  }));
}

/**
 * A snapshot as it comes back from storage, which may predate this shape.
 *
 * Older versions stored a flat `Record<string, unknown>`. Those entries are
 * genuine user values, so they are kept; keys the user had not set are simply
 * absent from them, and are indistinguishable from keys never captured. Treating
 * them as captured-and-unset is the safe reading: restoring removes the setting,
 * which is what an unset key should become.
 */
export function readSnapshot(stored: unknown, managedKeys: readonly string[]): SettingsSnapshot | undefined {
  if (!stored || typeof stored !== 'object') {
    return undefined;
  }
  const candidate = stored as Partial<SettingsSnapshot>;
  if (Array.isArray(candidate.keys) && candidate.values && typeof candidate.values === 'object') {
    return { keys: [...candidate.keys], values: { ...candidate.values } };
  }
  const legacy = stored as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return { keys: [...managedKeys], values };
}
