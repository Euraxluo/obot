import { m } from '$lib/i18n';
import type { ConnectorAccessRequest } from '$lib/services';
import { errors } from '$lib/stores';
import { formatTimeAgo } from '$lib/time';
import { preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import ConnectorApprovalsView from './ConnectorApprovalsView.svelte';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

function requestFixture(
	id: string,
	status: ConnectorAccessRequest['manifest']['status']
): ConnectorAccessRequest {
	return {
		id,
		created: '2026-10-26T08:00:00.000Z',
		manifest: {
			requesterUserID: '42',
			requesterUsername: 'enduser',
			requesterEmail: 'enduser@example.com',
			connectorID: 'mce1-connector',
			connectorName: '企业信息查询',
			mcpCatalogID: 'default',
			status,
			reason: '需要查数据'
		}
	};
}

async function renderView() {
	// ConnectorApprovalsView takes no props; preparePageData only initializes stores.
	await preparePageData();
	return render(ConnectorApprovalsView);
}

function mockRequests(requests: ConnectorAccessRequest[]) {
	worker.use(
		http.get('/api/connector-access-requests', ({ request }) => {
			const status = new URL(request.url).searchParams.get('status');
			return HttpResponse.json({
				items: status ? requests.filter((r) => r.manifest.status === status) : requests
			});
		})
	);
}

describe('ConnectorApprovalsView', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		errors.items = [];
	});

	it('shows a banner guiding admins to group policies with a link', async () => {
		mockRequests([]);

		await renderView();

		await expect
			.element(page.getByText(m.identity_access_connector_approvals_group_hint()))
			.toBeVisible();

		const link = page.getByRole('link', {
			name: new RegExp(m.identity_access_connector_approvals_group_link())
		});
		await expect.element(link).toBeVisible();
		await expect.element(link).toHaveAttribute('href', '/mcp-servers?view=policies');
	});
	it('shows a relative request time with the full date as a tooltip', async () => {
		const pending = requestFixture('car1-time', 'pending');
		pending.created = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
		mockRequests([pending]);

		await renderView();

		const timeCell = page.getByRole('row').filter({ hasText: 'enduser' }).getByRole('cell').nth(3);
		await expect.element(timeCell).toHaveTextContent(m.core_time_days_ago_other({ count: 2 }));
		await expect.element(timeCell).not.toHaveTextContent('[object Object]');
		await expect
			.element(timeCell)
			.toHaveAttribute('title', formatTimeAgo(pending.created).fullDate);
	});

	it('uses boxed filter tabs and moves the active pill when switching filters', async () => {
		mockRequests([]);

		await renderView();

		const filters = page.getByRole('tablist', {
			name: m.identity_access_connector_approvals()
		});
		const pending = filters.getByRole('tab', {
			name: m.identity_access_connector_approvals_filter_pending()
		});
		const all = filters.getByRole('tab', {
			name: m.identity_access_connector_approvals_filter_all()
		});

		await expect.element(filters).toHaveClass(/\btabs-box\b/);
		await expect.element(pending).toHaveClass(/\btab-active\b/);
		await expect.element(pending).toHaveAttribute('aria-selected', 'true');
		await expect.element(all).not.toHaveClass(/\btab-active\b/);
		await expect.element(all).toHaveAttribute('aria-selected', 'false');

		await all.click();

		await expect.element(all).toHaveClass(/\btab-active\b/);
		await expect.element(all).toHaveAttribute('aria-selected', 'true');
		await expect.element(pending).not.toHaveClass(/\btab-active\b/);
		await expect.element(pending).toHaveAttribute('aria-selected', 'false');

		await pending.click();

		await expect.element(pending).toHaveClass(/\btab-active\b/);
		await expect.element(all).not.toHaveClass(/\btab-active\b/);
	});

	it('lists pending requests and approves them', async () => {
		const pending = requestFixture('car1-pending', 'pending');
		mockRequests([pending]);
		const approve = vi.fn();
		worker.use(
			http.post('/api/connector-access-requests/car1-pending/approve', () => {
				approve();
				return HttpResponse.json({
					...pending,
					manifest: { ...pending.manifest, status: 'approved' }
				});
			})
		);

		await renderView();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(row).toBeVisible();
		await expect.element(row.getByText('企业信息查询')).toBeVisible();
		await expect
			.element(row.getByText(m.identity_access_connector_approvals_pending()))
			.toBeVisible();

		await row
			.getByRole('button', { name: m.identity_access_connector_approvals_approve() })
			.click();
		await expect.poll(() => approve).toHaveBeenCalledTimes(1);
		await expect
			.element(page.getByRole('row').filter({ hasText: 'enduser' }))
			.not.toBeInTheDocument();
	});

	it('rejects with a comment', async () => {
		const pending = requestFixture('car1-reject', 'pending');
		mockRequests([pending]);
		const reject = vi.fn();
		worker.use(
			http.post('/api/connector-access-requests/car1-reject/reject', () => {
				reject();
				return HttpResponse.json({
					...pending,
					manifest: { ...pending.manifest, status: 'rejected' }
				});
			})
		);

		await renderView();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await row.getByRole('button', { name: m.identity_access_connector_approvals_reject() }).click();

		const comment = page.getByRole('textbox');
		await comment.fill('暂不开放');
		await page
			.getByRole('button', { name: m.identity_access_connector_approvals_confirm() })
			.click();

		await expect.poll(() => reject).toHaveBeenCalledTimes(1);
	});

	it('switches to history and shows decided statuses', async () => {
		const approved = requestFixture('car1-approved', 'approved');
		const rejected = requestFixture('car1-rejected', 'rejected');
		mockRequests([approved, rejected]);

		await renderView();
		// Pending filter hides decided rows by default.
		await expect
			.element(page.getByRole('row').filter({ hasText: 'enduser' }))
			.not.toBeInTheDocument();

		await page
			.getByRole('tab', { name: m.identity_access_connector_approvals_filter_all() })
			.click();

		const rows = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(rows.nth(1)).toBeVisible();
		await expect
			.element(page.getByText(m.identity_access_connector_approvals_approved()))
			.toBeVisible();
		await expect
			.element(page.getByText(m.identity_access_connector_approvals_rejected()))
			.toBeVisible();
	});
	it('flags unpublished connectors and disables approval while keeping rejection enabled', async () => {
		const unpublished: ConnectorAccessRequest = {
			...requestFixture('car1-unpublished', 'pending'),
			connectorPublished: false
		};
		mockRequests([unpublished]);

		await renderView();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(row).toBeVisible();
		await expect
			.element(row.getByText(m.identity_access_connector_unpublished_warning()))
			.toBeVisible();

		const approveBtn = row.getByRole('button', {
			name: m.identity_access_connector_approvals_approve()
		});
		await expect.element(approveBtn).toBeDisabled();

		const rejectBtn = row.getByRole('button', {
			name: m.identity_access_connector_approvals_reject()
		});
		await expect.element(rejectBtn).toBeEnabled();
	});

	it('confirms and deletes a request, removing it from the list', async () => {
		const pending = requestFixture('car1-delete', 'pending');
		mockRequests([pending]);
		const deleteFn = vi.fn();
		worker.use(
			http.delete('/api/connector-access-requests/car1-delete', () => {
				deleteFn();
				return new HttpResponse(null, { status: 204 });
			})
		);

		await renderView();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(row).toBeVisible();

		await row.getByRole('button', { name: m.identity_access_connector_approvals_delete() }).click();

		await expect
			.element(page.getByText(m.identity_access_connector_approvals_delete_confirm_message()))
			.toBeVisible();

		await page
			.getByRole('button', { name: m.identity_access_connector_approvals_confirm() })
			.click();

		await expect.poll(() => deleteFn).toHaveBeenCalledTimes(1);
		await expect
			.element(page.getByRole('row').filter({ hasText: 'enduser' }))
			.not.toBeInTheDocument();
	});

	it('allows deleting an approved request from the history tab', async () => {
		const approved = requestFixture('car1-approved-del', 'approved');
		mockRequests([approved]);
		const deleteFn = vi.fn();
		worker.use(
			http.delete('/api/connector-access-requests/car1-approved-del', () => {
				deleteFn();
				return new HttpResponse(null, { status: 204 });
			})
		);

		await renderView();

		await page
			.getByRole('tab', { name: m.identity_access_connector_approvals_filter_all() })
			.click();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(row).toBeVisible();
		await expect
			.element(row.getByText(m.identity_access_connector_approvals_approved()))
			.toBeVisible();

		await row.getByRole('button', { name: m.identity_access_connector_approvals_delete() }).click();

		await expect
			.element(page.getByText(m.identity_access_connector_approvals_delete_confirm_message()))
			.toBeVisible();

		await page
			.getByRole('button', { name: m.identity_access_connector_approvals_confirm() })
			.click();

		await expect.poll(() => deleteFn).toHaveBeenCalledTimes(1);
		await expect
			.element(page.getByRole('row').filter({ hasText: 'enduser' }))
			.not.toBeInTheDocument();
	});
	it('keeps the request in the list and reports an error when approval fails with 400', async () => {
		const append = vi.spyOn(errors, 'append');
		const pending = requestFixture('car1-approve-fail', 'pending');
		mockRequests([pending]);
		worker.use(
			http.post('/api/connector-access-requests/car1-approve-fail/approve', () => {
				return HttpResponse.json({ message: 'connector not published' }, { status: 400 });
			})
		);

		await renderView();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(row).toBeVisible();

		const approveBtn = row.getByRole('button', {
			name: m.identity_access_connector_approvals_approve()
		});
		await approveBtn.click();

		await vi.waitFor(() => {
			expect(append.mock.calls.flat().join('\n')).toContain('400');
		});

		await expect.element(row).toBeVisible();
		await expect.element(approveBtn).toBeEnabled();
	});

	it('keeps the confirmation modal open and retains the row when delete fails with 500', async () => {
		const append = vi.spyOn(errors, 'append');
		const pending = requestFixture('car1-delete-fail', 'pending');
		mockRequests([pending]);
		worker.use(
			http.delete('/api/connector-access-requests/car1-delete-fail', () => {
				return HttpResponse.json({ message: 'internal server error' }, { status: 500 });
			})
		);

		await renderView();

		const row = page.getByRole('row').filter({ hasText: 'enduser' });
		await expect.element(row).toBeVisible();

		await row.getByRole('button', { name: m.identity_access_connector_approvals_delete() }).click();

		const confirmMsg = page.getByText(
			m.identity_access_connector_approvals_delete_confirm_message()
		);
		await expect.element(confirmMsg).toBeVisible();

		const confirmBtn = page.getByRole('button', {
			name: m.identity_access_connector_approvals_confirm()
		});
		await confirmBtn.click();

		await vi.waitFor(() => {
			expect(append.mock.calls.flat().join('\n')).toContain('500');
		});

		await expect.element(confirmMsg).toBeVisible();
		await expect.element(row).toBeVisible();
		await expect.element(confirmBtn).toBeEnabled();
	});
});
