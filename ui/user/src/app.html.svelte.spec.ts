import appHtml from './app.html?raw';
import { beforeEach, describe, expect, it } from 'vitest';

function runLocaleDefaultScript() {
	const parsed = new DOMParser().parseFromString(appHtml, 'text/html');
	const source = [...parsed.querySelectorAll('script')]
		.find((script) => script.textContent?.includes('ztocc_locale_default_v1'))
		?.textContent;

	if (!source) {
		throw new Error('The locale default script is missing from app.html');
	}

	const script = document.createElement('script');
	script.textContent = source;
	document.head.append(script);
	script.remove();
}

describe('app.html locale default', () => {
	beforeEach(() => {
		localStorage.removeItem('PARAGLIDE_LOCALE');
		localStorage.removeItem('ztocc_locale_default_v1');
	});

	it('sets zh-CN and records the one-shot marker on first load', () => {
		localStorage.setItem('PARAGLIDE_LOCALE', 'en');

		runLocaleDefaultScript();

		expect(localStorage.getItem('PARAGLIDE_LOCALE')).toBe('zh-CN');
		expect(localStorage.getItem('ztocc_locale_default_v1')).toBe('1');
	});

	it('keeps an explicitly selected en locale after the marker exists', () => {
		localStorage.setItem('PARAGLIDE_LOCALE', 'en');
		localStorage.setItem('ztocc_locale_default_v1', '1');

		runLocaleDefaultScript();

		expect(localStorage.getItem('PARAGLIDE_LOCALE')).toBe('en');
		expect(localStorage.getItem('ztocc_locale_default_v1')).toBe('1');
	});
});
