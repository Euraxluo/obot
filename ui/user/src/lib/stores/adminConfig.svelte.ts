import { AdminService, type AuthProvider } from '$lib/services';
import { writable, get } from 'svelte/store';

interface AdminConfig {
	authProviderConfigured: boolean;
	authProviders: AuthProvider[];
	eulaAccepted: boolean;
	loading: boolean;
	lastFetched: number | null;
}

const createAdminConfigStore = () => {
	const { subscribe, set, update } = writable<AdminConfig>({
		authProviderConfigured: false,
		authProviders: [],
		eulaAccepted: false,
		loading: false,
		lastFetched: null
	});

	let isInitialized = false;

	const fetchData = async (forceRefresh = false) => {
		const now = Date.now();
		const cacheAge = 5 * 60 * 1000;
		if (!forceRefresh && isInitialized && now - (get({ subscribe }).lastFetched ?? 0) < cacheAge) {
			return;
		}

		update((state) => ({ ...state, loading: true }));
		try {
			const [authProviders, eula] = await Promise.all([
				AdminService.listAuthProviders(),
				AdminService.getEula()
			]);
			set({
				authProviderConfigured: authProviders.some((provider) => provider.configured),
				authProviders,
				eulaAccepted: eula.accepted,
				loading: false,
				lastFetched: now
			});
			isInitialized = true;
		} catch (error) {
			console.error('Failed to fetch admin config:', error);
			update((state) => ({ ...state, loading: false }));
		}
	};

	const refresh = () => fetchData(true);
	const initialize = () => {
		if (!isInitialized) fetchData();
	};

	const updateAuthProviders = (authProviders: AuthProvider[]) => {
		update((state) => ({
			...state,
			authProviders,
			authProviderConfigured: authProviders.some((provider) => provider.configured)
		}));
	};

	const updateEula = (eulaAccepted: boolean) => {
		update((state) => ({ ...state, eulaAccepted }));
	};

	return { subscribe, refresh, initialize, fetchData, updateAuthProviders, updateEula };
};

export const adminConfigStore = createAdminConfigStore();
