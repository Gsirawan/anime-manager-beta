import { writable, derived } from 'svelte/store';
import { debounce } from '$lib/utils/debounce';

/** The live value — updated on every keystroke */
export const searchQuery = writable('');

/** Debounced value — settles 250ms after the last keystroke */
export const debouncedSearchQuery = writable('');

// Wire the debounced store to the live store.
// This module-level effect runs once when the store is first imported.
let _cancel: (() => void) | null = null;

const _updateDebounced = debounce((v: unknown) => {
	debouncedSearchQuery.set(v as string);
}, 250);

searchQuery.subscribe((v) => {
	_updateDebounced(v);
});

/** Derived: true when there is an active search query */
export const isSearching = derived(debouncedSearchQuery, ($q) => $q.trim().length > 0);
