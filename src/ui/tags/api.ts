// П13.2: клиент API тегов (контракт «П13. Теги»).
import type { TagDto, TagsResponse } from '@/server/tags/tags';
import { ApiError, cachedGet, call } from '../data/http';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchTags = (signal?: AbortSignal) => cachedGet<TagsResponse>('/api/tags', signal);
export const createTagApi = (name: string) => call<{ tag: TagDto }>('/api/tags', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
export const renameTagApi = (id: number, name: string) => call<{ id: number; name: string }>(`/api/tags/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
export const deleteTagApi = (id: number) => call<{ id: number }>(`/api/tags/${id}`, { method: 'DELETE' });
export const fetchGameTags = (gameId: number, signal?: AbortSignal) => call<{ tagIds: number[] }>(`/api/games/${gameId}/tags`, { signal });
export const putGameTags = (gameId: number, tagIds: number[]) =>
  call<{ tagIds: number[] }>(`/api/games/${gameId}/tags`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ tagIds }) });

export function tagErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'tag_exists') return 'Такой тег уже есть.';
    if (e.code === 'tag_limit') return 'Тегов уже 50 — удали ненужный.';
    if (e.status === 400) return 'Название тега: от 1 до 32 символов.';
    if (e.status === 404) return 'Тег не найден. Обнови страницу.';
    if (e.status === 401) return 'Сессия истекла. Войди заново.';
  }
  return 'Нет связи с сервером.';
}
