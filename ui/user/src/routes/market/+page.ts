import { handleRouteError } from '$lib/errors';
import { UserService, type ConnectorAccessRequest, type Skill, type VMCP } from '$lib/services';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
	const { profile } = await parent();

	let skills: Skill[] = [];
	let vmcps: VMCP[] = [];
	let requests: ConnectorAccessRequest[] = [];

	try {
		[skills, vmcps, requests] = await Promise.all([
			UserService.listSkills({ fetch, dontLogErrors: true }).catch(() => []),
			UserService.listVMCPs({ fetch }).catch(() => []),
			UserService.listConnectorAccessRequests({ fetch, mine: true }).catch(() => [])
		]);
	} catch (err) {
		handleRouteError(err, '/market', profile);
	}

	return {
		skills,
		vmcps,
		requests
	};
};
