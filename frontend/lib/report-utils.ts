import type { ReactNode } from 'react';

export type PlainObject = Record<string, unknown>;

export function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

export function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function getPath(source: unknown, keys: string[]): unknown {
  if (!isPlainObject(source)) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (!isEmptyValue(value)) return value;
  }
  return undefined;
}

export function pickEntries(source: unknown, keys: string[]): Array<[string, unknown]> {
  if (!isPlainObject(source)) return [];
  return keys
    .map((key) => [key, source[key]] as [string, unknown])
    .filter(([, value]) => !isEmptyValue(value));
}

export function firstObjectValue(source: unknown, keys: string[]): PlainObject {
  const value = getPath(source, keys);
  return isPlainObject(value) ? value : {};
}

export function objectEntries(source: unknown): Array<[string, unknown]> {
  if (!isPlainObject(source)) return [];
  return Object.entries(source).filter(([, value]) => !isEmptyValue(value));
}

export function findByKeyIncludes(source: unknown, terms: string[]): unknown {
  if (!isPlainObject(source)) return undefined;
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  const entry = Object.entries(source).find(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    return !isEmptyValue(value) && normalizedTerms.some((term) => normalizedKey.includes(term));
  });
  return entry?.[1];
}

export function getArtifact(result: unknown, key: string): PlainObject {
  if (!isPlainObject(result) || !isPlainObject(result.artifacts)) return {};
  const artifact = result.artifacts[key];
  return isPlainObject(artifact) ? artifact : {};
}

export function hasRenderableValue(value: unknown): boolean {
  return !isEmptyValue(value);
}

export type RenderUnknownValue = (value: unknown) => ReactNode;
