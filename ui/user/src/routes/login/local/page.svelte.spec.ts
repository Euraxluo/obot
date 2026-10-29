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

	it('does not render or load the development selector when the flag is off', async () => {
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
		await expect.element(page.getByText('Development identity selector')).not.toBeInTheDocument();
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(devRequest).not.toHaveBeenCalled();
	});

	it('offers fixed development roles and signs in as Admin', async () => {
		const { oauthRequests } = mockDevLoginApis();
		version.initialize({ devLoginEnabled: true });
		render(LoginPage, { navigate: navigateMock });

		await expect.element(page.getByText('Admin — admin@admin.com')).toBeInTheDocument();
		await expect.element(page.getByText('PowerUserPlus — create user1')).toBeInTheDocument();
		await expect.element(page.getByText('PowerUser — create user1')).toBeInTheDocument();
		await expect.element(page.getByText('Basic — create user1')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Enter' }).click();

		await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
		expect(oauthRequests.at(-1)?.get('email')).toBe('admin@admin.com');
	});

	it('creates the next userN with the specified password rule and signs in as Basic', async () => {
		const { createdUsers, oauthRequests } = mockDevLoginApis();
		version.initialize({ devLoginEnabled: true });
		render(LoginPage, { navigate: navigateMock });
		await expect.element(page.getByText('Admin — admin@admin.com')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Create user1 and sign in' }).click();

		await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/market'));
		expect(createdUsers).toEqual([
			{ email: 'user1@dev.local', password: 'user11111111', requirePasswordChange: false }
		]);
		expect(oauthRequests.at(-1)?.get('email')).toBe('user1@dev.local');
		await expect
			.element(page.getByRole('button', { name: 'Create user2 and sign in' }))
			.toBeVisible();
	});
});

function mockDevLoginApis() {
	let currentEmail = 'admin@admin.com';
	const oauthRequests: URLSearchParams[] = [];
	const createdUsers: { email: string; password: string; requirePasswordChange: boolean }[] = [];
	const localUsers = [{ id: '1', email: 'admin@admin.com', requirePasswordChange: false }];
	const adminOrgUser = {
		id: '1',
		created: '2026-01-01T00:00:00Z',
		username: 'admin',
		email: 'admin@admin.com',
		explicitRole: true,
		role: Role.ADMIN,
		effectiveRole: Role.ADMIN,
		groups: ['admin'],
		iconURL: ''
	};

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
				id: '1',
				email: currentEmail,
				username: currentEmail.split('@')[0],
				iconURL: '',
				role: currentEmail === 'admin@admin.com' ? Role.ADMIN : Role.BASIC,
				effectiveRole: currentEmail === 'admin@admin.com' ? Role.ADMIN : Role.BASIC,
				groups: currentEmail === 'admin@admin.com' ? ['admin'] : ['user'],
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
			localUsers.push({
				id: String(localUsers.length + 1),
				email: body.email,
				requirePasswordChange: false
			});
			return HttpResponse.json({ id: String(localUsers.length), ...body });
		}),
		http.get('/api/users', () => {
			const items =
				currentEmail === 'user1@dev.local'
					? [
							adminOrgUser,
							{
								...adminOrgUser,
								id: '2',
								username: 'user1',
								email: 'user1@dev.local',
								role: Role.BASIC,
								effectiveRole: Role.BASIC,
								groups: ['user']
							}
						]
					: [adminOrgUser];
			return HttpResponse.json({ items });
		})
	);

	return { createdUsers, oauthRequests };
}
