<script lang="ts">
	import { page } from '$app/state';
	import { tooltip } from '$lib/actions/tooltip.svelte';
	import CopyField from '$lib/components/CopyField.svelte';
	import ResponsiveDialog from '$lib/components/ResponsiveDialog.svelte';
	import Search from '$lib/components/Search.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import MarketplaceCard from '$lib/components/marketplace/MarketplaceCard.svelte';
	import MarketplaceGrid from '$lib/components/marketplace/MarketplaceGrid.svelte';
	import { PAGE_TRANSITION_DURATION } from '$lib/constants';
	import { sanitizeFilenameSegment, saveBlob } from '$lib/download';
	import { m } from '$lib/i18n';
	import { AdminService, UserService, type Skill } from '$lib/services';
	import type { SkillPublicationRule, SkillRepository } from '$lib/services/admin/types';
	import { AiClient, COMMON_AI_CLIENTS_MAP } from '$lib/services/user/constants';
	import { errors } from '$lib/stores';
	import { setUrlParamAndUpdateUrl } from '$lib/url';
	import { Bot, Download, PencilRuler, TriangleAlert } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		skills: Skill[];
		skillRepositories: SkillRepository[];
		showLicenseError: boolean;
		publicationRules?: SkillPublicationRule[];
		canManagePublication?: boolean;
	}

	let {
		skills,
		skillRepositories,
		showLicenseError,
		publicationRules = [],
		canManagePublication = false
	}: Props = $props();

	let query = $derived(page.url.searchParams.get('query') ?? '');
	let rules = $state<SkillPublicationRule[]>([]);
	let publishingSkillIDs = new SvelteSet<string>();
	let bulkPublishing = $state(false);
	let copyFields = $state<ReturnType<typeof CopyField>[]>([]);
	let installSkillDialog = $state<ReturnType<typeof ResponsiveDialog> | undefined>(undefined);
	let selectedSkillToInstall = $state<Skill | undefined>(undefined);
	let selectedTab = $state<'macos/linux' | 'windows'>('macos/linux');

	$effect(() => {
		rules = publicationRules;
	});
	let skillRepositoriesMap = $derived(
		new Map(skillRepositories.map((repository) => [repository.id, repository]))
	);
	let publicationRulesMap = $derived(new Map(rules.map((rule) => [rule.skillID, rule])));
	let clientUnzipCommands = $derived.by(() => {
		const skillName = sanitizeFilenameSegment(
			selectedSkillToInstall?.name ?? selectedSkillToInstall?.id ?? 'skill'
		);
		const command = (clientSkillsDirectory: string) => {
			if (selectedTab === 'windows') {
				const windowsSkillsDirectory = clientSkillsDirectory.replaceAll('/', '\\');
				return `Expand-Archive -LiteralPath "$env:USERPROFILE\\Downloads\\${skillName}.zip" -DestinationPath "$env:USERPROFILE\\${windowsSkillsDirectory}\\${skillName}" -Force`;
			}

			return `unzip "$HOME/Downloads/${skillName}.zip" -d "$HOME/${clientSkillsDirectory}/${skillName}"`;
		};

		return [
			{
				id: 'cursor',
				label: 'Cursor',
				icon: COMMON_AI_CLIENTS_MAP.get(AiClient.Cursor)?.icon,
				iconDark: COMMON_AI_CLIENTS_MAP.get(AiClient.Cursor)?.iconDark,
				command: command('.cursor/skills')
			},
			{
				id: 'claudeCode',
				label: 'Claude Code',
				icon: COMMON_AI_CLIENTS_MAP.get(AiClient.Claude)?.icon,
				iconDark: COMMON_AI_CLIENTS_MAP.get(AiClient.Claude)?.iconDark,
				command: command('.claude/skills')
			},
			{
				id: 'codex',
				label: 'Codex',
				icon: COMMON_AI_CLIENTS_MAP.get(AiClient.Codex)?.icon,
				iconDark: COMMON_AI_CLIENTS_MAP.get(AiClient.Codex)?.iconDark,
				command: command('.codex/skills')
			},
			{
				id: 'other',
				label: m.skills_other(),
				command: command('.agents/skills')
			}
		];
	});
	let visibleSkills = $derived(
		(query
			? skills.filter((skill) => {
					const normalizedQuery = query.toLowerCase();
					return (
						skillTitle(skill)?.toLowerCase().includes(normalizedQuery) ||
						skill.description?.toLowerCase().includes(normalizedQuery)
					);
				})
			: skills
		).map((skill) => ({
			...skill,
			repository: skill.repoID ? (skillRepositoriesMap.get(skill.repoID)?.displayName ?? '') : ''
		}))
	);

	function skillTitle(skill: Skill): string {
		return skill.name || skill.displayName || '';
	}

	function isPublished(skillID: string) {
		return publicationRulesMap.get(skillID)?.published ?? false;
	}

	async function updatePublication(skill: Skill, published: boolean) {
		if (!canManagePublication || publishingSkillIDs.has(skill.id)) return;

		await savePublication(skill, published);
	}

	async function savePublication(skill: Skill, published: boolean) {
		publishingSkillIDs.add(skill.id);
		try {
			const existing = publicationRulesMap.get(skill.id);
			const manifest = { skillID: skill.id, published };
			const updated = existing
				? await AdminService.updateSkillPublicationRule(existing.id, manifest)
				: await AdminService.createSkillPublicationRule(manifest);
			rules = existing
				? rules.map((rule) => (rule.id === updated.id ? updated : rule))
				: [...rules, updated];
		} catch (err) {
			errors.append(err);
		} finally {
			publishingSkillIDs.delete(skill.id);
		}
	}

	async function updateAllPublications(published: boolean) {
		if (!canManagePublication || bulkPublishing) return;

		bulkPublishing = true;
		try {
			const changes = skills.filter((skill) => isPublished(skill.id) !== published);
			for (const skill of changes) {
				// Rule creation is keyed by skill ID; concurrent creates can collide.
				await savePublication(skill, published);
			}
		} finally {
			bulkPublishing = false;
		}
	}

	function updateSearchQuery(value: string) {
		setUrlParamAndUpdateUrl(page.url, 'query', value);
	}

	async function handleDownloadSkill(skill?: Skill) {
		if (!skill) return;
		try {
			const blob = await UserService.downloadSkill(skill.id);
			const filename = `${sanitizeFilenameSegment(skill.name ?? skill.id)}.zip`;
			saveBlob(blob, filename);
		} catch (err) {
			console.error('Failed to download skill', err);
		}
	}
</script>

<div class="bg-base-200/70 min-h-full" in:fade={{ duration: PAGE_TRANSITION_DURATION }}>
	<div class="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-6">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">{m.skills_title()}</h2>
			<p class="text-muted-content mt-1 text-sm font-light">
				{m.skills_marketplace_subtitle({ count: skills.length })}
			</p>
		</div>
		<div class="flex w-full max-w-xl gap-2">
			<Search
				class="h-11 rounded-lg border-base-300/70 bg-base-100 shadow-sm"
				value={query}
				onChange={updateSearchQuery}
				placeholder={m.skills_search_skills()}
			/>
			{#if canManagePublication}
				<button
					type="button"
					class="btn btn-outline btn-sm shrink-0"
					disabled={bulkPublishing}
					data-testid="publish-all-skills"
					onclick={() => updateAllPublications(true)}
				>
					{m.skills_publish_all()}
				</button>
				<button
					type="button"
					class="btn btn-outline btn-sm shrink-0"
					disabled={bulkPublishing}
					data-testid="unpublish-all-skills"
					onclick={() => updateAllPublications(false)}
				>
					{m.skills_unpublish_all()}
				</button>
			{/if}
		</div>
	</div>

	{#if skills.length > 0}
		<div class="px-4 pb-6 md:px-6">
			<MarketplaceGrid>
				{#each visibleSkills as skill (skill.id)}
					{@const repository = skill.repoID
						? (skillRepositoriesMap.get(skill.repoID)?.displayName ?? '')
						: ''}
					<div
						class="group/skill-item relative flex flex-col transition-transform duration-200 hover:-translate-y-0.5"
					>
						<MarketplaceCard
							testId="skill-card-{skill.id}"
							title={skillTitle(skill) ?? m.skills_no_name()}
							description={skill.description}
							actionLabel={m.skills_install()}
							disabled={!skill.valid}
							class="hover:translate-y-0 w-full"
							classes={{ content: canManagePublication ? 'pr-28' : '' }}
							onAction={() => {
								selectedSkillToInstall = skill;
								installSkillDialog?.open();
							}}
						>
							{#snippet icon()}
								<span
									class="from-primary to-info flex size-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br text-primary-content shadow-sm"
								>
									<Bot class="size-5" />
								</span>
							{/snippet}
							{#snippet metadata()}
								<span class="text-muted-content flex items-center gap-2 text-xs font-light">
									{#if repository}
										<span class="truncate">{repository}</span>
										<span aria-hidden="true">·</span>
									{/if}
									<span>{skill.valid ? m.skills_ready_to_install() : m.skills_invalid()}</span>
									{#if skill.validationError}
										<span
											class="text-warning inline-flex"
											use:tooltip={{ text: skill.validationError }}
											aria-label={m.skills_invalid()}
										>
											<TriangleAlert class="size-3.5" />
										</span>
									{/if}
								</span>
							{/snippet}
						</MarketplaceCard>
						{#if canManagePublication}
							{@const publishing = publishingSkillIDs.has(skill.id)}
							<div
								class="absolute top-3 right-3 z-10 flex items-center rounded-lg px-2 py-1 transition-colors hover:bg-base-200/60 dark:hover:bg-base-300/40"
								role="presentation"
								onclick={(e) => e.stopPropagation()}
							>
								<Toggle
									label={m.skills_market_publish()}
									labelInline
									checked={isPublished(skill.id)}
									disabled={publishing || bulkPublishing}
									onChange={(published) => updatePublication(skill, published)}
									classes={{
										label: `text-xs select-none gap-2 cursor-pointer font-light transition-colors ${
											isPublished(skill.id) ? 'text-primary font-medium' : 'text-muted-content'
										}`,
										input: 'toggle-xs toggle-primary'
									}}
								/>
							</div>
						{/if}
					</div>
				{/each}
			</MarketplaceGrid>
		</div>
	{:else if showLicenseError}
		<div class="my-12 flex w-md flex-col items-center gap-4 self-center text-center">
			<TriangleAlert class="size-12 text-warning" />
			<h4 class="text-muted-content text-lg font-semibold">{m.skills_license_error()}</h4>
			<p class="text-muted-content text-sm font-light">
				{m.skills_license_error_prefix()}
				<a href="mailto:info@obot.ai" class="text-link">info@obot.ai</a
				>{m.skills_license_error_suffix()}
			</p>
		</div>
	{:else}
		<div class="my-12 flex w-md flex-col items-center gap-4 self-center text-center">
			<PencilRuler class="text-base-content/80 size-24" />
			<h4 class="text-muted-content text-lg font-semibold">{m.skills_no_skills()}</h4>
			<p class="text-muted-content text-sm font-light">
				{m.skills_no_skills_desc_line1()} <br />
				{m.skills_no_skills_desc_line2()}
			</p>
		</div>
	{/if}
</div>

<ResponsiveDialog
	bind:this={installSkillDialog}
	animate="slide"
	id="install-skill-dialog"
	title={selectedSkillToInstall ? skillTitle(selectedSkillToInstall) : ''}
>
	<div id="install-skill-dialog-content" class="w-full @container md:px-0 px-4">
		<div id="download-skill-container">
			<div class="divider md:mt-0">
				{m.skills_install_step_download({
					name: selectedSkillToInstall ? skillTitle(selectedSkillToInstall) : ''
				})}
			</div>
			<div class="md:p-0 md:pb-0 p-4">
				<button
					class="btn btn-primary btn-sm w-full"
					onclick={() => handleDownloadSkill(selectedSkillToInstall)}
				>
					<Download class="size-4" />
					{m.skills_download()}
				</button>
			</div>
		</div>
		<div class="divider">{m.skills_install_step_unzip()}</div>
		<div class="relative">
			<p class="absolute top-1/2 -translate-y-1/2 left-2 text-xs font-semibold">
				{m.skills_choose_os()}
			</p>
			<div
				id="install-skill-os-selector"
				role="tablist"
				class="tabs tabs-box tabs-sm flex items-center justify-end mb-1"
			>
				<button
					role="tab"
					class={twMerge('tab', selectedTab === 'macos/linux' && 'tab-active')}
					onclick={() => (selectedTab = 'macos/linux')}
					aria-selected={selectedTab === 'macos/linux'}
				>
					macOS/Linux
				</button>
				<button
					role="tab"
					class={twMerge('tab', selectedTab === 'windows' && 'tab-active')}
					onclick={() => (selectedTab = 'windows')}
					aria-selected={selectedTab === 'windows'}
				>
					Windows
				</button>
			</div>
		</div>
		<div id="unzip-skill-commands-container" class="flex gap-2 flex-col">
			{#each clientUnzipCommands as client, index (client.id)}
				<div id={`unzip-skill-command-${client.id}-container`}>
					<CopyField
						value={client.command}
						id={`command-${client.id}`}
						classes={{
							inputLabel: 'bg-base-100 dark:bg-base-300',
							input: 'font-mono'
						}}
						bind:this={copyFields[index]}
					>
						{#snippet preContent()}
							<span class="label shrink-0 w-38 mr-0 text-base-content">
								{#if client.icon || client.iconDark}
									<img
										src={client.iconDark ?? client.icon}
										alt={m.skills_branding_icon_alt({ client: client.label })}
										class="size-4 dark:block hidden"
									/>
									<img
										src={client?.icon}
										alt={m.skills_branding_icon_alt({ client: client.label })}
										class="size-4 block dark:hidden"
									/>
								{:else}
									<Bot class="size-4" />
								{/if}
								{client.label}
							</span>
						{/snippet}
					</CopyField>
				</div>
			{/each}
		</div>

		<div class="divider">3. 在 AI 客户端中调用</div>
		<div class="rounded-xl border border-primary/20 bg-primary/5 p-3.5 mb-2">
			<p class="text-xs text-muted-content leading-relaxed">
				解压完成后，在客户端对话中输入 <code class="text-primary font-mono font-semibold">/{sanitizeFilenameSegment(selectedSkillToInstall?.name ?? selectedSkillToInstall?.id ?? 'skill')}</code> 或向 AI 描述任务需求，即可自动调用该技能。
			</p>
		</div>

		{#if selectedSkillToInstall?.valid}
			<div class="mt-4 flex justify-end">
				<a
					href={`/skills/${selectedSkillToInstall.id}`}
					class="text-xs text-muted-content hover:text-primary underline underline-offset-2"
				>
					查看技能配置与源代码
				</a>
			</div>
		{/if}
	</div>
</ResponsiveDialog>
