import { AdminService, Role, UserService } from '$lib/services';
import type { LocalAuthUser, OrgUser, Profile } from '$lib/services';

// This module is intentionally loaded only after /api/version reports
// devLoginEnabled. Keeping it out of the static login-page chunk prevents the
// development administrator credentials from loading in production mode.
const DEV_ADMIN_EMAIL = 'admin@admin.com';
const DEV_ADMIN_PASSWORD = 'ShotTemp9!2026';
const DEV_EMAIL_DOMAIN = 'dev.local';

export const DEV_IDENTITY_ROLES = [
	{ id: 'admin', label: 'Admin', role: Role.ADMIN },
	{ id: 'power-user-plus', label: 'PowerUserPlus', role: Role.POWERUSER_PLUS },
	{ id: 'power-user', label: 'PowerUser', role: Role.POWERUSER },
	{ id: 'basic', label: 'Basic', role: Role.BASIC }
] as const;

export type DevIdentityRoleId = (typeof DEV_IDENTITY_ROLES)[number]['id'];

export interface DevIdentity {
	roleId: DevIdentityRoleId;
	label: string;
	role: number;
	username: string;
	email: string;
	password: string;
	existing: boolean;
}

export interface DevIdentityCatalog {
	identities: DevIdentity[];
	nextUsername: string;
}

function passwordFor(username: string): string {
	const digits = username.slice('user'.length);
	if (!/^\d+$/.test(digits)) throw new Error(`Invalid development username: ${username}`);
	// Seven repeats makes the shortest account (user1) meet local auth's 12-character minimum.
	return username + digits.repeat(7);
}

function emailFor(username: string): string {
	return `${username}@${DEV_EMAIL_DOMAIN}`;
}

function nextUsername(localUsers: LocalAuthUser[]): string {
	const next = localUsers.reduce((max, user) => {
		const match = /^user(\d+)$/.exec(user.email.split('@')[0]?.toLowerCase() ?? '');
		return match ? Math.max(max, Number(match[1])) : max;
	}, 0);
	return `user${next + 1}`;
}

function normalize(email: string | undefined): string {
	return (email ?? '').trim().toLowerCase();
}

function primaryRole(role = 0): number {
	return role & ~Role.AUDITOR;
}

function hasIdentityRole(role: number, identity: DevIdentity): boolean {
	if (identity.roleId === 'admin') {
		return (primaryRole(role) & (Role.ADMIN | Role.OWNER)) !== 0;
	}
	return primaryRole(role) === identity.role;
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

function identityFor(
	role: (typeof DEV_IDENTITY_ROLES)[number],
	localUsers: LocalAuthUser[],
	users: OrgUser[],
	username: string
): DevIdentity {
	if (role.id === 'admin') {
		return {
			roleId: role.id,
			label: role.label,
			role: role.role,
			username: DEV_ADMIN_EMAIL.split('@')[0],
			email: DEV_ADMIN_EMAIL,
			password: DEV_ADMIN_PASSWORD,
			existing: true
		};
	}

	const usersByEmail = new Map(users.map((user) => [normalize(user.email), user]));
	const existing = localUsers.find((localUser) => {
		const orgUser = usersByEmail.get(normalize(localUser.email));
		return orgUser && primaryRole(orgUser.effectiveRole) === role.role;
	});
	const selectedUsername = existing?.email.split('@')[0]?.toLowerCase() ?? username;

	return {
		roleId: role.id,
		label: role.label,
		role: role.role,
		username: selectedUsername,
		email: existing?.email ?? emailFor(selectedUsername),
		password: existing ? passwordFor(selectedUsername) : passwordFor(username),
		existing: Boolean(existing)
	};
}

function catalog(localUsers: LocalAuthUser[], users: OrgUser[]): DevIdentityCatalog {
	const username = nextUsername(localUsers);
	return {
		identities: DEV_IDENTITY_ROLES.map((role) => identityFor(role, localUsers, users, username)),
		nextUsername: username
	};
}

async function loadCatalog(): Promise<DevIdentityCatalog> {
	const [localUsers, users] = await Promise.all([
		AdminService.listLocalAuthUsers(),
		UserService.listUsers()
	]);
	return catalog(localUsers, users);
}

export async function prepareDevIdentities(): Promise<DevIdentityCatalog> {
	await adminLogin();
	return await loadCatalog();
}

async function ensureLocalUser(identity: DevIdentity): Promise<LocalAuthUser> {
	const localUsers = await AdminService.listLocalAuthUsers();
	const existing = localUsers.find((user) => normalize(user.email) === normalize(identity.email));
	if (existing) return existing;
	return await AdminService.createLocalAuthUser(identity.email, identity.password, false);
}

async function ensureRole(identity: DevIdentity, profile: Profile): Promise<void> {
	// The profile is authoritative immediately, while the user list can briefly omit
	// an identity that is still being provisioned from its first sign-in.
	if (hasIdentityRole(profile.effectiveRole, identity)) return;

	await adminLogin();
	await AdminService.updateUserRole(profile.id, identity.role);
}

export async function enterIdentity(
	identity: DevIdentity
): Promise<{ profile: Profile; destination: string }> {
	await adminLogin();

	if (identity.roleId !== 'admin') {
		await ensureLocalUser(identity);
	}

	let profile = await login(identity.email, identity.password);
	await ensureRole(identity, profile);
	if (!hasIdentityRole(profile.effectiveRole, identity)) {
		await adminLogin();
		profile = await login(identity.email, identity.password);
	}

	if (!hasIdentityRole(profile.effectiveRole, identity)) {
		throw new Error(`Development account ${identity.email} did not receive ${identity.label}`);
	}

	return {
		profile,
		destination: identity.role === Role.BASIC ? '/market' : '/dashboard'
	};
}

export async function createBasicIdentity(): Promise<{
	catalog: DevIdentityCatalog;
	profile: Profile;
	destination: string;
}> {
	await adminLogin();
	const current = await loadCatalog();
	const username = current.nextUsername;
	const identity: DevIdentity = {
		roleId: 'basic',
		label: 'Basic',
		role: Role.BASIC,
		username,
		email: emailFor(username),
		password: passwordFor(username),
		existing: false
	};

	await AdminService.createLocalAuthUser(identity.email, identity.password, false);
	let profile = await login(identity.email, identity.password);
	await ensureRole(identity, profile);
	if (!hasIdentityRole(profile.effectiveRole, identity)) {
		await adminLogin();
		profile = await login(identity.email, identity.password);
	}

	await adminLogin();
	const [localUsers, users] = await Promise.all([
		AdminService.listLocalAuthUsers(),
		UserService.listUsers()
	]);
	profile = await login(identity.email, identity.password);
	return {
		catalog: catalog(localUsers, users),
		profile,
		destination: '/market'
	};
}
