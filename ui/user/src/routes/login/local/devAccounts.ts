// Account metadata is safe in the static login chunk; devIdentity.ts keeps the
// corresponding passwords isolated in its lazily loaded chunk.
export const DEV_ACCOUNTS = [
	{ id: 'admin', email: 'admin@admin.com', roleId: 'admin' },
	{ id: 'poweruser1', email: 'poweruser1@dev.local', roleId: 'power-user' },
	{ id: 'user1', email: 'user1@dev.local', roleId: 'basic' },
	{ id: 'user2', email: 'user2@dev.local', roleId: 'basic' }
] as const;

export type DevAccount = (typeof DEV_ACCOUNTS)[number];
export type DevAccountRoleId = DevAccount['roleId'];
