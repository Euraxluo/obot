import { browser } from '$app/environment';
import { m } from '$lib/i18n';
import type { AppPreferences } from '$lib/services';

export const DEFAULT_LOGOS = {
	// Logo.svelte variants
	icon: {
		default: '/user/images/ztocc/driver-app-logo.png',
		error: '/user/images/ztocc/driver-app-logo.png',
		warning: '/user/images/ztocc/driver-app-logo.png'
	},
	// BetaLogo.svelte variants
	beta: {
		dark: {
			chat: '/user/images/ztocc/drp-admin-logo.png',
			enterprise: '/user/images/ztocc/drp-admin-logo.png',
			community: '/user/images/ztocc/drp-admin-logo.png',
			default: '/user/images/ztocc/drp-admin-logo.png'
		},
		light: {
			chat: '/user/images/ztocc/ztocc-logo.png',
			enterprise: '/user/images/ztocc/ztocc-logo.png',
			community: '/user/images/ztocc/ztocc-logo.png',
			default: '/user/images/ztocc/ztocc-logo.png'
		}
	}
} as const;

export const DEFAULT_DISPLAY_NAME = 'ZTOCC';

/** Default UI font stack; kept in sync with `app.css` (`--theme-font-family` fallback). */
export const DEFAULT_FONT_FAMILY =
	'Poppins, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji';

export const FONT_FAMILY_PRESETS: { label: string; value: string }[] = [
	{ label: 'Poppins', value: DEFAULT_FONT_FAMILY },
	{
		label: 'Helvetica Neue',
		value:
			'Helvetica Neue, Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji'
	},
	{ label: m.core_font_system_default(), value: 'ui-sans-serif, system-ui, sans-serif' }
];

export function compileAppPreferences(preferences?: AppPreferences): AppPreferences {
	return {
		displayName: preferences?.displayName?.trim() || DEFAULT_DISPLAY_NAME,
		logos: {
			logoIcon: preferences?.logos?.logoIcon ?? DEFAULT_LOGOS.icon.default,
			logoIconError: preferences?.logos?.logoIconError ?? DEFAULT_LOGOS.icon.error,
			logoIconWarning: preferences?.logos?.logoIconWarning ?? DEFAULT_LOGOS.icon.warning,
			logoDefault: preferences?.logos?.logoDefault ?? DEFAULT_LOGOS.beta.light.default,
			logoEnterprise: preferences?.logos?.logoEnterprise ?? DEFAULT_LOGOS.beta.light.enterprise,
			logoCommunity: preferences?.logos?.logoCommunity ?? DEFAULT_LOGOS.beta.light.community,
			logoChat: preferences?.logos?.logoChat ?? DEFAULT_LOGOS.beta.light.chat,
			darkLogoDefault: preferences?.logos?.darkLogoDefault ?? DEFAULT_LOGOS.beta.dark.default,
			darkLogoChat: preferences?.logos?.darkLogoChat ?? DEFAULT_LOGOS.beta.dark.chat,
			darkLogoEnterprise:
				preferences?.logos?.darkLogoEnterprise ?? DEFAULT_LOGOS.beta.dark.enterprise,
			darkLogoCommunity: preferences?.logos?.darkLogoCommunity ?? DEFAULT_LOGOS.beta.dark.community
		},
		theme: {
			backgroundColor: preferences?.theme?.backgroundColor ?? '#f2f7f4',
			onBackgroundColor: preferences?.theme?.onBackgroundColor ?? '#1e3431',
			surface1Color: preferences?.theme?.surface1Color ?? '#ffffff',
			surface2Color: preferences?.theme?.surface2Color ?? '#e4eee9',
			surface3Color: preferences?.theme?.surface3Color ?? '#d8e6df',
			secondaryColor: preferences?.theme?.secondaryColor ?? '#e4eee9',
			successColor: preferences?.theme?.successColor ?? '#159a91',
			warningColor: preferences?.theme?.warningColor ?? '#b97d10',
			errorColor: preferences?.theme?.errorColor ?? '#d64545',
			primaryColor: preferences?.theme?.primaryColor ?? '#159a91',
			onPrimaryColor: preferences?.theme?.onPrimaryColor ?? '#f2f7f4',
			onSuccessColor: preferences?.theme?.onSuccessColor ?? '#f2f7f4',
			onWarningColor: preferences?.theme?.onWarningColor ?? '#f2f7f4',
			onErrorColor: preferences?.theme?.onErrorColor ?? '#f2f7f4',
			darkBackgroundColor: preferences?.theme?.darkBackgroundColor ?? '#0e1514',
			darkOnBackgroundColor: preferences?.theme?.darkOnBackgroundColor ?? '#c4d3ce',
			darkSurface1Color: preferences?.theme?.darkSurface1Color ?? '#17211f',
			darkSurface2Color: preferences?.theme?.darkSurface2Color ?? '#1e2b29',
			darkSurface3Color: preferences?.theme?.darkSurface3Color ?? '#2a3a37',
			darkSecondaryColor: preferences?.theme?.darkSecondaryColor ?? '#1e2b29',
			darkSuccessColor: preferences?.theme?.darkSuccessColor ?? '#159a91',
			darkWarningColor: preferences?.theme?.darkWarningColor ?? '#b97d10',
			darkErrorColor: preferences?.theme?.darkErrorColor ?? '#d64545',
			darkPrimaryColor: preferences?.theme?.darkPrimaryColor ?? '#2dd4bf',
			darkOnPrimaryColor: preferences?.theme?.darkOnPrimaryColor ?? '#f2f7f4',
			darkOnSuccessColor: preferences?.theme?.darkOnSuccessColor ?? '#f2f7f4',
			darkOnWarningColor: preferences?.theme?.darkOnWarningColor ?? '#f2f7f4',
			darkOnErrorColor: preferences?.theme?.darkOnErrorColor ?? '#f2f7f4',
			fontFamily: preferences?.theme?.fontFamily ?? DEFAULT_FONT_FAMILY
		}
	};
}

const store = $state<{
	current: AppPreferences;
	loaded: boolean;
	setThemeColors: (colors: AppPreferences['theme']) => void;
	initialize: (preferences: AppPreferences) => void;
}>({
	current: compileAppPreferences(),
	loaded: false,
	setThemeColors,
	initialize
});

function setThemeColors(colors: AppPreferences['theme']) {
	// Set light theme colors
	document.documentElement.style.setProperty('--theme-background-light', colors.backgroundColor);
	document.documentElement.style.setProperty(
		'--theme-on-background-light',
		colors.onBackgroundColor
	);
	document.documentElement.style.setProperty('--theme-surface1-light', colors.surface1Color);
	document.documentElement.style.setProperty('--theme-surface2-light', colors.surface2Color);
	document.documentElement.style.setProperty('--theme-surface3-light', colors.surface3Color);
	document.documentElement.style.setProperty('--theme-primary-light', colors.primaryColor);
	document.documentElement.style.setProperty('--theme-on-primary-light', colors.onPrimaryColor);
	document.documentElement.style.setProperty('--theme-on-success-light', colors.onSuccessColor);
	document.documentElement.style.setProperty('--theme-on-warning-light', colors.onWarningColor);
	document.documentElement.style.setProperty('--theme-on-error-light', colors.onErrorColor);
	document.documentElement.style.setProperty('--theme-secondary-light', colors.secondaryColor);
	document.documentElement.style.setProperty('--theme-success-light', colors.successColor);
	document.documentElement.style.setProperty('--theme-warning-light', colors.warningColor);
	document.documentElement.style.setProperty('--theme-error-light', colors.errorColor);

	// Set dark theme colors
	document.documentElement.style.setProperty('--theme-background-dark', colors.darkBackgroundColor);
	document.documentElement.style.setProperty(
		'--theme-on-background-dark',
		colors.darkOnBackgroundColor
	);
	document.documentElement.style.setProperty('--theme-surface1-dark', colors.darkSurface1Color);
	document.documentElement.style.setProperty('--theme-surface2-dark', colors.darkSurface2Color);
	document.documentElement.style.setProperty('--theme-surface3-dark', colors.darkSurface3Color);
	document.documentElement.style.setProperty('--theme-primary-dark', colors.darkPrimaryColor);
	document.documentElement.style.setProperty('--theme-on-primary-dark', colors.darkOnPrimaryColor);
	document.documentElement.style.setProperty('--theme-on-success-dark', colors.darkOnSuccessColor);
	document.documentElement.style.setProperty('--theme-on-warning-dark', colors.darkOnWarningColor);
	document.documentElement.style.setProperty('--theme-on-error-dark', colors.darkOnErrorColor);
	document.documentElement.style.setProperty('--theme-secondary-dark', colors.darkSecondaryColor);
	document.documentElement.style.setProperty('--theme-success-dark', colors.darkSuccessColor);
	document.documentElement.style.setProperty('--theme-warning-dark', colors.darkWarningColor);
	document.documentElement.style.setProperty('--theme-error-dark', colors.darkErrorColor);
	document.documentElement.style.setProperty('--theme-font-family', colors.fontFamily);
}

function initialize(preferences: AppPreferences) {
	store.current = preferences;
	store.loaded = true;
	if (browser) {
		store.setThemeColors(store.current.theme);
	}
}

export default store;
