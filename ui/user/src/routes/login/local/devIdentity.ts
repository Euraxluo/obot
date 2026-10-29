import { AdminService, Role, UserService } from '$lib/services';
import type { Profile } from '$lib/services';
import { DEV_ACCOUNTS, type DevAccount, type DevAccountRoleId } from './devAccounts';

// This module is intentionally loaded only after /api/version reports
// devLoginEnabled. Keeping it out of the static login-page chunk prevents the
// development account passwords from loading in production mode.
const DEV_ADMIN_EMAIL = 'admin@admin.com';
const DEV_ADMIN_PASSWORD = 'ShotTemp9!2026';

type ProvisionableAccount = DevAccount & { role: number };

const DEV_ACCOUNT_ROLES: Record<DevAccountRoleId, number> = {
	admin: Role.ADMIN,
	'power-user': Role.POWERUSER,
	basic: Role.BASIC
};

const PROVISIONABLE_ACCOUNTS: readonly ProvisionableAccount[] = DEV_ACCOUNTS.map((account) => ({
	...account,
	role: DEV_ACCOUNT_ROLES[account.roleId]
}));

function normalize(email: string | undefined): string {
	return (email ?? '').trim().toLowerCase();
}

function primaryRole(role = 0): number {
	return role & ~Role.AUDITOR;
}

function hasAccountRole(role: number, account: ProvisionableAccount): boolean {
	if (account.id === 'admin') {
		return (primaryRole(role) & (Role.ADMIN | Role.OWNER)) !== 0;
	}
	return primaryRole(role) === account.role;
}

// The repeated numeric suffix keeps every fixed account above local auth's
// 12-character minimum while remaining deterministic in local tests.
function passwordFor(account: DevAccount): string {
	const digits = /\d+$/.exec(account.id)?.[0];
	if (!digits) throw new Error(`Invalid development account: ${account.id}`);
	return account.id + digits.repeat(7);
}

async function login(email: string, password: string): Promise<Profile> {
	const response = await fetch('/oauth2/start', {
		method: 'POST',
		credentials: 'same-origin',
		redirect: 'manual',
		body: new URLSearchParams({ email, password, rd: '/' })
	});
	if (response.status >= 400) {
		throw new Error('Development login failed');
	}

	const profile = await UserService.getProfile();
	if (profile.unauthorized || normalize(profile.email) !== normalize(email)) {
		throw new Error('Development login did not establish the requested session');
	}
	return profile;
}

async function adminLogin(): Promise<void> {
	await login(DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD);
}

async function ensureLocalUser(account: DevAccount): Promise<void> {
	const localUsers = await AdminService.listLocalAuthUsers();
	const existing = localUsers.some((user) => normalize(user.email) === account.email);
	if (existing) return;

	await AdminService.createLocalAuthUser(account.email, passwordFor(account), false);
}

async function ensureRole(account: ProvisionableAccount, profile: Profile): Promise<void> {
	// The profile is authoritative immediately after the first target login,
	// including when local auth provisioned the corresponding organization user.
	if (hasAccountRole(profile.effectiveRole, account)) return;

	await adminLogin();
	await AdminService.updateUserRole(profile.id, account.role);
}

export async function enterDevAccount(accountId: string): Promise<{
	profile: Profile;
	destination: string;
}> {
	const account = PROVISIONABLE_ACCOUNTS.find((candidate) => candidate.id === accountId);
	if (!account) throw new Error(`Unknown development account: ${accountId}`);

	await adminLogin();
	if (account.id !== 'admin') {
		await ensureLocalUser(account);
	}

	const password = account.id === 'admin' ? DEV_ADMIN_PASSWORD : passwordFor(account);
	let profile = await login(account.email, password);
	await ensureRole(account, profile);
	if (!hasAccountRole(profile.effectiveRole, account)) {
		await adminLogin();
		profile = await login(account.email, password);
	}

	if (!hasAccountRole(profile.effectiveRole, account)) {
		throw new Error(`Development account ${account.email} did not receive its expected role`);
	}

	return {
		profile,
		destination: '/dashboard'
	};
}
