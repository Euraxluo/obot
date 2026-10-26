import { m } from '$lib/i18n';
import type { ConnectorAccessRequest } from '$lib/services';
import { preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import ConnectorApprovalsView from './ConnectorApprovalsView.svelte';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
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
	const data = await preparePageData();
	return render(ConnectorApprovalsView, { data });
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
			.getByRole('button', { name: m.identity_access_connector_approvals_filter_all() })
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
});
