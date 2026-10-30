import { m } from '$lib/i18n';
import { AdminService, type Skill } from '$lib/services';
import { worker } from '../../tests/mocks/worker';
import SkillsView from './SkillsView.svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { http, HttpResponse } from 'msw';

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

	it('publishes one skill through its marketplace toggle', async () => {
		const createRule = vi.spyOn(AdminService, 'createSkillPublicationRule').mockResolvedValue({
			id: 'spr1-marketplace',
			created: '2026-10-30T00:00:00Z',
			skillID: 'skill-marketplace',
			published: true
		});

		render(SkillsView, {
			props: {
				skills,
				skillRepositories: [],
				showLicenseError: false,
				publicationRules: [],
				canManagePublication: true
			}
		});

		// The toggle is a sibling of the card's test-id element, not a descendant.
		const toggle = page.getByRole('switch', { name: m.skills_market_publish() }).first();
		await expect.element(toggle).toBeEnabled();
		await toggle.click();

		await expect.poll(() => createRule).toHaveBeenCalledOnce();
		expect(createRule).toHaveBeenCalledWith({
			skillID: 'skill-marketplace',
			published: true
		});
	});

	it('publishes all skills in bulk', async () => {
		const createRule = vi
			.spyOn(AdminService, 'createSkillPublicationRule')
			.mockImplementation(async (request) => ({
				id: `spr1-${request.skillID}`,
				created: '2026-10-30T00:00:00Z',
				skillID: request.skillID,
				published: request.published
			}));

		render(SkillsView, {
			props: {
				skills,
				skillRepositories: [],
				showLicenseError: false,
				publicationRules: [],
				canManagePublication: true
			}
		});

		await page.getByTestId('publish-all-skills').click();

		await expect.poll(() => createRule).toHaveBeenCalledTimes(2);
	});

	it('unpublishes existing rules through bulk update', async () => {
		const updateRule = vi
			.spyOn(AdminService, 'updateSkillPublicationRule')
			.mockImplementation(async (_id, request) => ({
				id: `spr1-${request.skillID}`,
				created: '2026-10-30T00:00:00Z',
				skillID: request.skillID,
				published: request.published
			}));

		render(SkillsView, {
			props: {
				skills,
				skillRepositories: [],
				showLicenseError: false,
				publicationRules: skills.map((skill) => ({
					id: `spr1-${skill.id}`,
					created: '2026-10-30T00:00:00Z',
					skillID: skill.id,
					published: true
				})),
				canManagePublication: true
			}
		});

		await page.getByTestId('unpublish-all-skills').click();

		await expect.poll(() => updateRule).toHaveBeenCalledTimes(2);
		expect(updateRule).toHaveBeenCalledWith('spr1-skill-marketplace', {
			skillID: 'skill-marketplace',
			published: false
		});
		expect(updateRule).toHaveBeenCalledWith('spr1-skill-reporting', {
			skillID: 'skill-reporting',
			published: false
		});
	});

	it('opens the install skill dialog when clicking a skill card', async () => {
		worker.use(
			http.get(`/api/skills/skill-marketplace/download-url`, () =>
				HttpResponse.json({ path: '/api/skills/skill-marketplace/download?expires=1&token=t' })
			)
		);

		render(SkillsView, {
			props: {
				skills,
				skillRepositories: [],
				showLicenseError: false
			}
		});

		const card = page.getByTestId('skill-card-skill-marketplace');
		await card.click();

		const dialog = page.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByText('Marketplace Name')).toBeVisible();
		await expect.element(dialog.getByText(m.skills_install_step_command())).toBeVisible();
		await expect
			.element(dialog.getByText('Claude Code'))
			.toBeVisible();
	});
});
