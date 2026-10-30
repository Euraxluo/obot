// Client for Obot's MCP guardrail API. Guardrails configure the checkers, from built-in regex
// and secrets detection to external services; MCP filters apply them to tool calls.
import { m } from '$lib/i18n';
import { doDelete, doGet, doPost, doPut, type Fetcher } from '../http';

type Opts = { fetch?: Fetcher; signal?: AbortSignal; dontLogErrors?: boolean };

const B = '/guardrails';

export type GuardrailTarget = 'mcp';
export type GuardrailStage = 'input' | 'output';
export type GuardrailApplyTo = GuardrailStage | 'both';
export type GuardrailAction = 'block' | 'redact' | 'log';
export type GuardrailInputScope = 'all' | 'latest';
export type GuardrailOutcome = 'blocked' | 'redacted' | 'logged' | 'error';

export type GuardrailFieldType =
	| 'text'
	| 'textarea'
	| 'password'
	| 'number'
	| 'bool'
	| 'select'
	| 'list';

export interface GuardrailField {
	name: string;
	label: string;
	description?: string;
	type: GuardrailFieldType;
	options?: string[];
	default?: unknown;
	required?: boolean;
	sensitive?: boolean;
	destination?: boolean;
	/** The field's choices can be loaded from the configured service. */
	optionsFromService?: boolean;
}

// The categories the server puts guardrail types in.
export const GUARDRAIL_CATEGORY_BUILT_IN = 'Built-in';
export const GUARDRAIL_CATEGORY_INTEGRATIONS = 'Integrations';

/** A guardrail type's category, as shown to the user. */
export function guardrailCategoryLabel(category: string): string {
	switch (category) {
		case GUARDRAIL_CATEGORY_BUILT_IN:
			return m.guardrails_category_built_in();
		case GUARDRAIL_CATEGORY_INTEGRATIONS:
			return m.guardrails_category_integrations();
		default:
			return category;
	}
}

export interface GuardrailProvider {
	type: string;
	label: string;
	description: string;
	category: string;
	fields: GuardrailField[];
	redacts: boolean;
}

export interface Guardrail {
	id?: string;
	name: string;
	description?: string;
	type: string;
	config: Record<string, unknown>;
	configuredSecrets?: string[];
	error?: string;
	created?: string;
	updated?: string;
}

export interface GuardrailFinding {
	category: string;
	message?: string;
	score?: number;
	count?: number;
}

export interface GuardrailTestResult {
	findings: GuardrailFinding[];
	redactedText?: string;
	canRedact: boolean;
	error?: string;
}

export const APPLY_TO_LABELS: Record<GuardrailApplyTo, string> = {
	input: m.core_col_input(),
	output: m.core_col_output(),
	both: m.guardrails_label_apply_to_both()
};

export const ACTION_LABELS: Record<GuardrailAction, string> = {
	block: m.guardrails_label_action_block(),
	redact: m.guardrails_label_action_redact(),
	log: m.guardrails_label_action_log()
};

export const OUTCOME_LABELS: Record<GuardrailOutcome, string> = {
	blocked: m.audit_usage_audit_logs_model_guardrail_outcome_blocked(),
	redacted: m.audit_usage_audit_logs_model_guardrail_outcome_redacted(),
	logged: m.audit_usage_audit_logs_model_guardrail_outcome_logged(),
	error: m.audit_usage_audit_logs_model_guardrail_outcome_error()
};

export async function listGuardrailProviders(opts?: Opts): Promise<GuardrailProvider[]> {
	const resp = (await doGet(`${B}/providers`, opts)) as { items: GuardrailProvider[] | null };
	return resp.items ?? [];
}

export async function validateGuardrailCondition(
	target: GuardrailTarget,
	condition: string,
	opts?: Opts
): Promise<{ valid: boolean; error?: string }> {
	return (await doPost(`${B}/validate-condition`, { target, condition }, opts)) as {
		valid: boolean;
		error?: string;
	};
}

export async function listGuardrails(opts?: Opts): Promise<Guardrail[]> {
	const resp = (await doGet(B, opts)) as { items: Guardrail[] | null };
	return resp.items ?? [];
}

export async function getGuardrail(id: string, opts?: Opts): Promise<Guardrail> {
	return (await doGet(`${B}/${encodeURIComponent(id)}`, opts)) as Guardrail;
}

export async function createGuardrail(guardrail: Guardrail, opts?: Opts): Promise<Guardrail> {
	return (await doPost(B, guardrail, opts)) as Guardrail;
}

export async function updateGuardrail(
	id: string,
	guardrail: Guardrail,
	opts?: Opts
): Promise<Guardrail> {
	return (await doPut(`${B}/${encodeURIComponent(id)}`, guardrail, opts)) as Guardrail;
}

export async function deleteGuardrail(id: string, opts?: Opts): Promise<void> {
	await doDelete(`${B}/${encodeURIComponent(id)}`, opts);
}

/**
 * Loads a guardrail field's choices from the service its settings point at. Sensitive
 * settings left empty use the saved guardrail's when guardrailID names one.
 */
export async function loadGuardrailFieldOptions(
	type: string,
	field: string,
	body: { guardrailID?: string; config: Record<string, unknown> },
	opts?: Opts
): Promise<string[]> {
	const res = (await doPost(
		`${B}/providers/${encodeURIComponent(type)}/fields/${encodeURIComponent(field)}/options`,
		body,
		opts
	)) as { items?: string[] };
	return res.items ?? [];
}

export async function testGuardrail(
	id: string,
	body: { target: GuardrailTarget; stage: GuardrailStage; text: string },
	opts?: Opts
): Promise<GuardrailTestResult> {
	return (await doPost(`${B}/${encodeURIComponent(id)}/test`, body, opts)) as GuardrailTestResult;
}

/** Summarizes findings as "Category ×count, Category". */
export function findingsSummary(findings?: GuardrailFinding[] | null): string {
	if (!findings?.length) return '';
	return findings
		.map((f) => (f.count && f.count > 1 ? `${f.category} ×${f.count}` : f.category))
		.join(', ');
}
