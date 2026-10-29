import { Role } from '$lib/services';
import { version } from '$lib/stores';
import { worker } from '../../../tests/mocks/worker';
import LoginPage from './+page.svelte';
import { http, HttpResponse, passthrough } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const navigateMock = vi.fn();

const emailKey = 'local-auth-email';
const email = 'someone@example.com';

// The form posts to the auth provider, which redirects back here with `?error=` on failure.
function setQuery(query: string) {
	window.history.replaceState(null, '', window.location.pathname + query);
}

afterEach(() => {
	setQuery('');
	version.initialize({});
	navigateMock.mockClear();
});

beforeEach(() => {
	localStorage.setItem('PARAGLIDE_LOCALE', 'en');
});

describe('local login page', () => {
	it('preserves the redirect destination in the login form', async () => {
		const rd = '/mcp-servers?view=all&search=a%20b#details';
		setQuery('?rd=' + encodeURIComponent(rd));

		render(LoginPage, { navigate: navigateMock });

		await expect.element(page.getByCSS('input[name="rd"]')).toHaveValue(rd);
	});

	it('focuses the email input on load', async () => {
		render(LoginPage, { navigate: navigateMock });

		await expect.element(page.getByLabelText('Email')).toHaveAttribute('autofocus');
		await expect.element(page.getByLabelText('Email')).toHaveFocus();
	});

	it('restores the saved email after a failed login and clears it', async () => {
		sessionStorage.setItem(emailKey, email);
		setQuery('?error=Incorrect+email+or+password.');

		render(LoginPage);

		await expect.element(page.getByText('Incorrect email or password.')).toBeVisible();
		await expect.element(page.getByLabelText('Email')).toHaveValue(email);
		await expect.element(page.getByLabelText('Password', { exact: false })).toHaveValue('');
		expect(sessionStorage.getItem(emailKey)).toBeNull();
	});

	it('does not reuse a saved email on a visit without an error', async () => {
		sessionStorage.setItem(emailKey, email);

		render(LoginPage);

		await expect.element(page.getByLabelText('Email')).toHaveValue('');
		expect(sessionStorage.getItem(emailKey)).toBeNull();
	});

	it('saves the email when the form is submitted', async () => {
		render(LoginPage);
		await page.getByLabelText('Email').fill(email);

		// A real submit navigates the test browser away. Dispatching the event on the form runs the
		// page's handler without submitting anything.
		page
			.getByRole('button', { name: 'Sign in' })
			.element()
			.closest('form')
			?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		expect(sessionStorage.getItem(emailKey)).toBe(email);
	});

	it('does not render or load the development picker when the flag is off', async () => {
		const devRequest = vi.fn();
		worker.use(
			http.post('/oauth2/start', () => {
				devRequest();
				return HttpResponse.json({});
			}),
			http.get('/api/local-auth/users', () => {
				devRequest();
				return HttpResponse.json({ items: [] });
			})
		);

		version.initialize({ devLoginEnabled: false });
		render(LoginPage);

		await expect.element(page.getByLabelText('Email')).toBeVisible();
		await expect.element(page.getByLabelText('Dev quick enter')).not.toBeInTheDocument();
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(devRequest).not.toHaveBeenCalled();
	});

	it('lists fixed development accounts and enters Admin on selection', async () => {
		const { oauthRequests } = mockDevLoginApis();
		version.initialize({ devLoginEnabled: true });
		render(LoginPage, { navigate: navigateMock });

		await expect.element(page.getByText('admin@admin.com — Administrator')).toBeInTheDocument();
		await expect.element(page.getByText('poweruser1@dev.local — Power user')).toBeInTheDocument();
		await expect.element(page.getByText('user1@dev.local — Basic')).toBeInTheDocument();
		await expect.element(page.getByText('user2@dev.local — Basic')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Enter' })).not.toBeInTheDocument();

		await page.getByLabelText('Dev quick enter').selectOptions('admin');

		await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
		expect(oauthRequests.at(-1)?.get('email')).toBe('admin@admin.com');
		expect(oauthRequests.some((request) => request.get('password') === 'ShotTemp9!2026')).toBe(
			true
		);
	});

	it('transparently provisions and enters every fixed non-admin account', async () => {
		const { createdUsers, oauthRequests, updatedRoles } = mockDevLoginApis();
		version.initialize({ devLoginEnabled: true });
		render(LoginPage, { navigate: navigateMock });
		await expect.element(page.getByLabelText('Dev quick enter')).toBeVisible();

		await page.getByLabelText('Dev quick enter').selectOptions('poweruser1');
		await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
		await page.getByLabelText('Dev quick enter').selectOptions('user1');
		await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
		await page.getByLabelText('Dev quick enter').selectOptions('user2');
		await vi.waitFor(() => {
			expect(navigateMock).toHaveBeenCalledTimes(3);
			expect(navigateMock.mock.calls[2][0]).toBe('/dashboard');
		});

		expect(createdUsers).toEqual([
			{
				email: 'poweruser1@dev.local',
				password: 'poweruser11111111',
				requirePasswordChange: false
			},
			{ email: 'user1@dev.local', password: 'user11111111', requirePasswordChange: false },
			{ email: 'user2@dev.local', password: 'user22222222', requirePasswordChange: false }
		]);
		expect(updatedRoles).toContainEqual({ id: 'poweruser1@dev.local', role: Role.POWERUSER });
		for (const account of ['poweruser1@dev.local', 'user1@dev.local', 'user2@dev.local']) {
			const accountRequests = oauthRequests.filter((request) => request.get('email') === account);
			expect(accountRequests.at(-1)?.get('email')).toBe(account);
		}
	});

	it('returns the picker to its placeholder when development login fails', async () => {
		mockDevLoginApis();
		worker.use(http.post('/oauth2/start', () => HttpResponse.json({}, { status: 401 })));
		version.initialize({ devLoginEnabled: true });
		render(LoginPage, { navigate: navigateMock });

		await page.getByLabelText('Dev quick enter').selectOptions('admin');

		await expect.element(page.getByText('Development login failed')).toBeVisible();
		await expect.element(page.getByLabelText('Dev quick enter')).toHaveValue('');
	});
});

function mockDevLoginApis() {
	let currentEmail = 'admin@admin.com';
	const oauthRequests: URLSearchParams[] = [];
	const createdUsers: { email: string; password: string; requirePasswordChange: boolean }[] = [];
	const updatedRoles: { id: string; role: number }[] = [];
	const localUsers = [
		{ id: 'admin@admin.com', email: 'admin@admin.com', requirePasswordChange: false }
	];
	const roles = new Map<string, number>([['admin@admin.com', Role.ADMIN]]);

	worker.use(
		http.get(/\/src\/routes\/login\/local\/devIdentity\.ts/, passthrough),
		http.post('/oauth2/start', async ({ request }) => {
			const body = new URLSearchParams(await request.text());
			oauthRequests.push(body);
			currentEmail = body.get('email') ?? currentEmail;
			return HttpResponse.json({});
		}),
		http.get('/api/me', () =>
			HttpResponse.json({
				id: currentEmail,
				email: currentEmail,
				username: currentEmail.split('@')[0],
				iconURL: '',
				role: roles.get(currentEmail) ?? Role.BASIC,
				effectiveRole: roles.get(currentEmail) ?? Role.BASIC,
				groups: (roles.get(currentEmail) ?? Role.BASIC) === Role.ADMIN ? ['admin'] : ['user'],
				unauthorized: false
			})
		),
		http.get('/api/local-auth/users', () => HttpResponse.json({ items: localUsers })),
		http.post('/api/local-auth/users', async ({ request }) => {
			const body = (await request.json()) as {
				email: string;
				password: string;
				requirePasswordChange: boolean;
			};
			createdUsers.push(body);
			roles.set(body.email, Role.BASIC);
			localUsers.push({ id: body.email, email: body.email, requirePasswordChange: false });
			return HttpResponse.json({ id: body.email, ...body });
		}),
		http.patch('/api/users/:id', async ({ request, params }) => {
			const body = (await request.json()) as { role: number };
			roles.set(String(params.id), body.role);
			updatedRoles.push({ id: String(params.id), role: body.role });
			return HttpResponse.json({});
		})
	);

	return { createdUsers, oauthRequests, updatedRoles };
}
