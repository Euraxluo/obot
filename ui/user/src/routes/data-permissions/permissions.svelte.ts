import type {
	PermissionDatabaseGraph,
	PermissionGraph,
	PermissionValue,
	TablePermissionValue
} from './metabase';

export interface PermissionRow {
	id: string;
	label: string;
	scope: 'database' | 'table';
	databaseId: number;
	tableId?: number;
	viewData: PermissionValue;
	createQueries: PermissionValue;
}

function enumValue(value: unknown, fallback: PermissionValue): PermissionValue {
	return typeof value === 'string' ? (value as PermissionValue) : fallback;
}

function tablePermission(value: unknown): TablePermissionValue {
	if (typeof value === 'string') {
		return value === 'all' || value === 'blocked'
			? value
			: value === 'none' || value === 'no'
				? 'none'
				: 'none';
	}
	if (value && typeof value === 'object') {
		const record = value as { read?: unknown; query?: unknown };
		if (record.read === 'all' || record.query === 'all') return 'all';
	}
	return 'none';
}

export function tableGraphValue(value: TablePermissionValue): Record<string, string> {
	return value === 'all' ? { read: 'all' } : { read: 'none' };
}

export function permissionRows(
	groupId: number,
	databases: {
		id: number;
		name: string;
		tables?: { id: number; name: string; display_name?: string; schema?: string }[];
	}[],
	graph: PermissionGraph
): PermissionRow[] {
	const groupGraph = graph.groups[String(groupId)] ?? {};
	const rows: PermissionRow[] = [];
	for (const database of databases) {
		const databaseGraph = groupGraph[String(database.id)] ?? {};
		rows.push({
			id: `db-${database.id}`,
			label: database.name,
			scope: 'database',
			databaseId: database.id,
			viewData: enumValue(databaseGraph['view-data'], 'blocked'),
			createQueries: enumValue(databaseGraph['create-queries'], 'no')
		});
		for (const table of database.tables ?? []) {
			const viewData = databaseGraph['view-data'];
			const createQueries = databaseGraph['create-queries'];
			const schemaGraph =
				typeof viewData === 'object' && viewData !== null
					? ((viewData as Record<string, unknown>)[table.schema ?? ''] as
							| Record<string, unknown>
							| undefined)
					: undefined;
			const queryGraph =
				typeof createQueries === 'object' && createQueries !== null
					? ((createQueries as Record<string, unknown>)[table.schema ?? ''] as
							| Record<string, unknown>
							| undefined)
					: undefined;
			rows.push({
				id: `table-${database.id}-${table.id}`,
				label: `${table.schema ? `${table.schema}.` : ''}${table.display_name ?? table.name}`,
				scope: 'table',
				databaseId: database.id,
				tableId: table.id,
				viewData: schemaGraph
					? tablePermission(schemaGraph[String(table.id)])
					: enumValue(databaseGraph['view-data'], 'blocked'),
				createQueries: schemaGraph
					? tablePermission(schemaGraph[String(table.id)])
					: enumValue(databaseGraph['create-queries'], 'no')
			});
		}
	}
	return rows;
}

export function applyPermission(
	graph: PermissionGraph,
	groupId: number,
	row: PermissionRow,
	field: 'view-data' | 'create-queries',
	value: PermissionValue
): PermissionGraph {
	const nextGraph: PermissionGraph = JSON.parse(JSON.stringify(graph)) as PermissionGraph;
	const groupGraph = nextGraph.groups[String(groupId)] ?? {};
	const databaseGraph: PermissionDatabaseGraph = { ...(groupGraph[String(row.databaseId)] ?? {}) };

	if (row.scope === 'database') {
		databaseGraph[field] = value;
	} else {
		const tables = row.tableId ? [row.tableId] : [];
		if (tables.length === 0) return nextGraph;
		const current = databaseGraph[field];
		const schemas =
			current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
		const schemaName = row.label.split('.')[0] || '';
		const tableMap = { ...(schemas[schemaName] as Record<string, unknown> | undefined) };
		tableMap[String(row.tableId)] =
			field === 'view-data' ? tableGraphValue(value === 'all' ? 'all' : 'none') : value;
		schemas[schemaName] = tableMap;
		databaseGraph[field] = schemas;
	}

	groupGraph[String(row.databaseId)] = databaseGraph;
	nextGraph.groups[String(groupId)] = groupGraph;
	return nextGraph;
}

export function databasesWithChanges(
	graph: PermissionGraph,
	original: PermissionGraph
): Set<number> {
	const changed = new Set<number>();
	for (const [groupId, groupGraph] of Object.entries(graph.groups)) {
		for (const [databaseId, databaseGraph] of Object.entries(groupGraph ?? {})) {
			if (
				JSON.stringify(databaseGraph) !== JSON.stringify(original.groups[groupId]?.[databaseId])
			) {
				const id = Number(databaseId);
				if (Number.isFinite(id)) changed.add(id);
			}
		}
	}
	return changed;
}
