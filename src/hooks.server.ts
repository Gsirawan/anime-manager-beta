import { bootRuntime } from '$lib/server/runtime';
import type { Handle } from '@sveltejs/kit';

bootRuntime();

export const handle: Handle = async ({ event, resolve }) => resolve(event);
