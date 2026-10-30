import { appPreferences } from '$lib/stores';

export function productTitle(suffix = ''): string {
	const title = `${appPreferences.current.displayName} | ${suffix}`;
	return suffix ? title : appPreferences.current.displayName;
}
