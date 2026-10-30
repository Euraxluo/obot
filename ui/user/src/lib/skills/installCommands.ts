import { AiClient, COMMON_AI_CLIENTS_MAP } from '$lib/services/user/constants';
import { m } from '$lib/i18n';

export type SkillInstallOS = 'macos/linux' | 'windows';

export interface SkillInstallCommand {
	id: string;
	label: string;
	icon?: string;
	iconDark?: string;
	command: string;
}

/**
 * One-line install commands for each AI client: download the signed skill zip
 * into a temp directory, unzip it into the client's skills directory, and clean
 * up. The download URL is a short-lived signed path minted by the server, so
 * the command works from any shell without a browser session.
 */
export function buildSkillInstallCommands(options: {
	downloadURL: string;
	skillName: string;
	os: SkillInstallOS;
}): SkillInstallCommand[] {
	const { downloadURL, skillName, os } = options;

	const command = (clientSkillsDirectory: string) => {
		if (os === 'windows') {
			const windowsSkillsDirectory = clientSkillsDirectory.replaceAll('/', '\\');
			return `$z=Join-Path $env:TEMP '${skillName}.zip'; Invoke-WebRequest "${downloadURL}" -OutFile $z; Expand-Archive -LiteralPath $z -DestinationPath "$env:USERPROFILE\\${windowsSkillsDirectory}\\${skillName}" -Force; Remove-Item $z`;
		}

		return `tmp="$(mktemp -d)" && curl -fsSL "${downloadURL}" -o "$tmp/skill.zip" && mkdir -p "$HOME/${clientSkillsDirectory}/${skillName}" && unzip -oq "$tmp/skill.zip" -d "$HOME/${clientSkillsDirectory}/${skillName}" && rm -rf "$tmp"`;
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
			id: 'workbuddy',
			label: 'WorkBuddy',
			icon: COMMON_AI_CLIENTS_MAP.get(AiClient.WorkBuddy)?.icon,
			command: command('.workbuddy/skills')
		},
		{
			id: 'other',
			label: m.skills_other(),
			command: command('.agents/skills')
		}
	];
}
