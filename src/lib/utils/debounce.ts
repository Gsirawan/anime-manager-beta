/**
 * Returns a debounced version of fn that delays invocation by `ms` milliseconds.
 * The debounced function also exposes a `.cancel()` method.
 */
export function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	ms: number
): T & { cancel(): void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const debounced = (...args: unknown[]) => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, ms);
	};
	debounced.cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};
	return debounced as T & { cancel(): void };
}
