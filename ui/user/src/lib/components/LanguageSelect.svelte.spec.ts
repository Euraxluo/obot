import LanguageSelect from './LanguageSelect.svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { overwriteSetLocale, setLocale } from '$lib/paraglide/runtime';

const originalSetLocale = setLocale;

describe('LanguageSelect.svelte', () => {
	const mockSetLocale = vi.fn();

	beforeEach(async () => {
		await cleanup();
		mockSetLocale.mockClear();
		originalSetLocale('en', { reload: false });
		overwriteSetLocale(mockSetLocale);
	});

	afterEach(async () => {
		await cleanup();
		overwriteSetLocale(originalSetLocale);
	});

	it('lists every supported language by its native name, defaulting to English', async () => {
		await render(LanguageSelect);

		await expect.element(page.getByRole('button', { name: /Language/ })).toMatchTextContent('EN');
		await page.getByRole('button', { name: /Language/ }).click();

		await expect.element(page.getByRole('heading', { name: 'Select Language' })).toBeVisible();
		await expect.element(page.getByRole('radio', { name: 'English' })).toBeChecked();
		for (const name of ['English', '日本語', '한국어', '简体中文']) {
			await expect.element(page.getByRole('radio', { name })).toBeInTheDocument();
		}
	});

	it('switches the locale when a different language is applied', async () => {
		await render(LanguageSelect);

		await page.getByRole('button', { name: /Language/ }).click();
		await page.getByRole('radio', { name: '日本語' }).click();
		await page.getByRole('button', { name: 'Apply' }).click();

		expect(mockSetLocale).toHaveBeenCalledWith('ja');
	});

	it('keeps the current locale when the dialog is cancelled', async () => {
		await render(LanguageSelect);

		await page.getByRole('button', { name: /Language/ }).click();
		await page.getByRole('radio', { name: '한국어' }).click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		expect(mockSetLocale).not.toHaveBeenCalled();
	});

	it('renders in the locale saved from a previous visit', async () => {
		localStorage.setItem('PARAGLIDE_LOCALE', 'ja');
		await render(LanguageSelect);

		await page.getByRole('button', { name: /言語/ }).click();

		await expect.element(page.getByRole('heading', { name: '言語を選択' })).toBeVisible();
		await expect.element(page.getByRole('radio', { name: '日本語' })).toBeChecked();
	});
});
