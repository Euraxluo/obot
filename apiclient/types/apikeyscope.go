package types

const (
	APIKeyScopeAPI         = "api"
	APIKeyScopeSkills      = "skills"
	APIKeyScopeAllMCP      = "all-mcp"
	APIKeyScopeDeviceScans = "device-scans"
)

func DefaultCLIAPIKeyScopes() []string {
	return []string{APIKeyScopeDeviceScans, APIKeyScopeSkills}
}
