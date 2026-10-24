import type { Skill } from '$lib/services';
import SkillsView from './SkillsView.svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

const skills: Skill[] = [
	{
		id: 'skill-marketplace',
		type: 'skill',
		name: 'Marketplace Name',
		displayName: 'Display Name Override',
		description: 'Marketplace skill description',
		valid: true
	},
	{
		id: 'skill-reporting',
		type: 'skill',
		name: 'Reporting',
		displayName: 'Reporting Display',
		description: 'Reporting skill',
		valid: true
	}
];

describe('SkillsView', () => {
	it('renders skill cards using the manifest name', () => {
		render(SkillsView, {
			props: {
				skills,
				skillRepositories: [],
				showLicenseError: false
			}
		});

		expect(document.querySelector('[data-testid="skill-card-skill-marketplace"]')).not.toBeNull();
		expect(document.body.textContent).toContain('Marketplace Name');
		expect(document.body.textContent).toContain('Reporting');
	});
});
