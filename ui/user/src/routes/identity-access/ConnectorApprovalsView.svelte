<script lang="ts">
	import ResponsiveDialog from '$lib/components/ResponsiveDialog.svelte';
	import { m } from '$lib/i18n';
	import {
		UserService,
		type ConnectorAccessRequest,
		type ConnectorAccessRequestStatus
	} from '$lib/services';
	import { errors } from '$lib/stores';
	import { formatTimeAgo } from '$lib/time';
	import { Check, Loader2, Trash2, X } from '@lucide/svelte';
	import { onMount } from 'svelte';

	type Filter = 'pending' | 'all';

	let requests = $state<ConnectorAccessRequest[]>([]);
	let filter = $state<Filter>('pending');
	let loading = $state(true);
	let actingID = $state('');
	let rejectTarget = $state<ConnectorAccessRequest>();
	let rejectDialog = $state<ReturnType<typeof ResponsiveDialog>>();
	let rejectComment = $state('');
	let rejecting = $state(false);
	let deleteTarget = $state<ConnectorAccessRequest>();
	let deleteDialog = $state<ReturnType<typeof ResponsiveDialog>>();
	let deleting = $state(false);

	onMount(refresh);

	async function refresh() {
		loading = true;
		try {
			requests = await UserService.listConnectorAccessRequests({
				status: filter === 'pending' ? 'pending' : undefined
			});
		} finally {
			loading = false;
		}
	}

	function switchFilter(next: Filter) {
		filter = next;
		void refresh();
	}

	function statusLabel(status: ConnectorAccessRequestStatus) {
		switch (status) {
			case 'pending':
				return m.identity_access_connector_approvals_pending();
			case 'approved':
				return m.identity_access_connector_approvals_approved();
			default:
				return m.identity_access_connector_approvals_rejected();
		}
	}

	function statusClass(status: ConnectorAccessRequestStatus) {
		switch (status) {
			case 'pending':
				return 'badge-warning badge-sm';
			case 'approved':
				return 'badge-primary badge-sm';
			default:
				return 'badge-error badge-sm';
		}
	}

	async function approve(request: ConnectorAccessRequest) {
		if (actingID) return;
		actingID = request.id;
		try {
			await UserService.approveConnectorAccessRequest(request.id);
			requests = requests.filter((candidate) => candidate.id !== request.id);
		} catch (err) {
			errors.append(err);
		} finally {
			actingID = '';
		}
	}

	async function confirmReject() {
		const target = rejectTarget;
		if (!target || rejecting) return;
		rejecting = true;
		try {
			await UserService.rejectConnectorAccessRequest(target.id, rejectComment.trim());
			requests = requests.filter((candidate) => candidate.id !== target.id);
			rejectTarget = undefined;
			rejectDialog?.close();
			rejectComment = '';
		} catch (err) {
			errors.append(err);
		} finally {
			rejecting = false;
		}
	}

	async function confirmDelete() {
		const target = deleteTarget;
		if (!target || deleting) return;
		deleting = true;
		try {
			await UserService.deleteConnectorAccessRequest(target.id);
			requests = requests.filter((candidate) => candidate.id !== target.id);
			deleteTarget = undefined;
			deleteDialog?.close();
		} catch (err) {
			errors.append(err);
		} finally {
			deleting = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div
		class="bg-base-100 border-base-300 dark:bg-base-200 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs shadow-xs"
	>
		<div class="flex items-center gap-2">
			<span class="badge badge-info badge-soft badge-xs">TIP</span>
			<span class="text-muted-content font-light">
				{m.identity_access_connector_approvals_group_hint()}
			</span>
		</div>
		<a
			class="link link-primary font-medium hover:underline shrink-0"
			href="/mcp-servers?view=policies"
		>
			{m.identity_access_connector_approvals_group_link()} &rarr;
		</a>
	</div>

	<div class="flex items-center justify-between gap-3">
		<div
			role="tablist"
			class="tabs tabs-box bg-base-100 shadow-sm dark:bg-base-300"
			aria-label={m.identity_access_connector_approvals()}
		>
			{#each ['pending', 'all'] as option (option)}
				<button
					type="button"
					role="tab"
					aria-selected={filter === option}
					class="tab text-xs min-w-24 {filter === option
						? 'tab-active bg-base-300 dark:bg-base-100'
						: ''}"
					onclick={() => switchFilter(option as Filter)}
				>
					{option === 'pending'
						? m.identity_access_connector_approvals_filter_pending()
						: m.identity_access_connector_approvals_filter_all()}
				</button>
			{/each}
		</div>
		{#if loading}
			<Loader2 class="text-muted-content size-4 animate-spin" />
		{/if}
	</div>

	{#if !loading && requests.length === 0}
		<p class="text-muted-content py-16 text-center text-sm">
			{m.identity_access_connector_approvals_empty()}
		</p>
	{:else}
		<div class="border-base-300 overflow-x-auto rounded-xl border">
			<table class="table table-sm">
				<thead>
					<tr>
						<th>{m.identity_access_connector_approvals_applicant()}</th>
						<th>{m.identity_access_connector_approvals_connector()}</th>
						<th>{m.identity_access_connector_approvals_reason()}</th>
						<th>{m.identity_access_connector_approvals_time()}</th>
						<th>{m.identity_access_connector_approvals_status()}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each requests as request (request.id)}
						<tr data-testid={`connector-request-${request.id}`}>
							<td>
								{request.manifest.requesterUsername ||
									request.manifest.requesterEmail ||
									request.manifest.requesterUserID}
							</td>
							<td>
								<div class="flex flex-col items-start gap-1">
									<span>{request.manifest.connectorName || request.manifest.connectorID}</span>
									{#if request.connectorPublished === false}
										<span class="badge badge-warning badge-xs">
											{m.identity_access_connector_unpublished_warning()}
										</span>
									{/if}
								</div>
							</td>
							<td class="max-w-48 truncate" title={request.manifest.reason}>
								{request.manifest.reason || '—'}
							</td>
							<td
								class="whitespace-nowrap"
								title={request.created ? formatTimeAgo(request.created).fullDate : undefined}
							>
								{#if request.created}
									{formatTimeAgo(request.created).relativeTime}
								{/if}
							</td>
							<td>
								<span class={statusClass(request.manifest.status)}>
									{statusLabel(request.manifest.status)}
								</span>
							</td>
							<td>
								<div class="flex justify-end gap-2">
									{#if request.manifest.status === 'pending'}
										<button
											type="button"
											class="btn btn-primary btn-xs rounded-lg"
											disabled={actingID === request.id || request.connectorPublished === false}
											title={request.connectorPublished === false
												? m.identity_access_connector_unpublished_warning()
												: undefined}
											onclick={() => approve(request)}
										>
											{#if actingID === request.id}
												<Loader2 class="size-3 animate-spin" />
											{:else}
												<Check class="size-3" />
											{/if}
											{m.identity_access_connector_approvals_approve()}
										</button>
										<button
											type="button"
											class="btn btn-ghost btn-xs rounded-lg text-error"
											onclick={() => {
												rejectTarget = request;
												rejectComment = '';
												rejectDialog?.open();
											}}
										>
											<X class="size-3" />
											{m.identity_access_connector_approvals_reject()}
										</button>
									{/if}
									<button
										type="button"
										class="btn btn-ghost btn-xs rounded-lg text-error"
										title={m.identity_access_connector_approvals_delete()}
										aria-label={m.identity_access_connector_approvals_delete()}
										onclick={() => {
											deleteTarget = request;
											deleteDialog?.open();
										}}
									>
										<Trash2 class="size-3" />
										{m.identity_access_connector_approvals_delete()}
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<ResponsiveDialog
	bind:this={rejectDialog}
	title={m.identity_access_connector_approvals_reject()}
	onClose={() => (rejectTarget = undefined)}
>
	{#if rejectTarget}
		<div class="flex flex-col gap-3">
			<p class="text-muted-content text-sm">
				{rejectTarget.manifest.connectorName || rejectTarget.manifest.connectorID}
			</p>
			<input
				type="text"
				class="input input-sm w-full rounded-lg border-base-300/70 bg-base-100"
				aria-label={m.identity_access_connector_approvals_comment_label()}
				bind:value={rejectComment}
			/>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => {
						rejectTarget = undefined;
						rejectDialog?.close();
					}}
				>
					{m.identity_access_connector_approvals_cancel()}
				</button>
				<button
					type="button"
					class="btn btn-error btn-sm"
					disabled={rejecting}
					onclick={confirmReject}
				>
					{m.identity_access_connector_approvals_confirm()}
				</button>
			</div>
		</div>
	{/if}
</ResponsiveDialog>

<ResponsiveDialog
	bind:this={deleteDialog}
	title={m.identity_access_connector_approvals_delete()}
	onClose={() => (deleteTarget = undefined)}
>
	{#if deleteTarget}
		<div class="flex flex-col gap-3">
			<p class="text-muted-content text-sm">
				{deleteTarget.manifest.connectorName || deleteTarget.manifest.connectorID}
			</p>
			<p class="text-sm">
				{m.identity_access_connector_approvals_delete_confirm_message()}
			</p>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => {
						deleteTarget = undefined;
						deleteDialog?.close();
					}}
				>
					{m.identity_access_connector_approvals_cancel()}
				</button>
				<button
					type="button"
					class="btn btn-error btn-sm"
					disabled={deleting}
					onclick={confirmDelete}
				>
					{#if deleting}
						<Loader2 class="size-3 animate-spin" />
					{/if}
					{m.identity_access_connector_approvals_confirm()}
				</button>
			</div>
		</div>
	{/if}
</ResponsiveDialog>
