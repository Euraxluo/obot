package types

import (
	"encoding/json"
	"time"
)

const (
	// Guardrail targets.
	GuardrailTargetMCP = "mcp"

	// Guardrail stages a policy applies to.
	GuardrailApplyInput  = "input"
	GuardrailApplyOutput = "output"
	GuardrailApplyBoth   = "both"

	// Guardrail actions.
	GuardrailActionBlock  = "block"
	GuardrailActionRedact = "redact"
	GuardrailActionLog    = "log"

	// Guardrail input scopes.
	GuardrailScopeAll    = "all"
	GuardrailScopeLatest = "latest"
)

// GuardrailPolicy is the in-memory policy compiled from an MCP guardrail filter.
type GuardrailPolicy struct {
	ID          string    `gorm:"primaryKey;type:text" json:"id"`
	CreatedAt   time.Time `json:"created"`
	UpdatedAt   time.Time `json:"updated"`
	Name        string    `gorm:"type:text;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	Enabled     bool      `gorm:"not null" json:"enabled"`
	// Target is mcp (tool call arguments and results).
	Target string `gorm:"type:text;not null" json:"target"`
	// ApplyTo is input, output or both.
	ApplyTo string `gorm:"type:text;not null" json:"applyTo"`
	// Action is block, redact or log.
	Action string `gorm:"type:text;not null" json:"action"`
	// Condition is an optional CEL expression that must be true for the policy to apply.
	Condition string `gorm:"type:text" json:"condition,omitempty"`
	// SamplingRate is the percentage (1-100) of matching requests the policy checks.
	SamplingRate int `gorm:"not null" json:"samplingRate"`
	// FailClosed blocks the request when a guardrail can't be evaluated.
	FailClosed bool `gorm:"not null" json:"failClosed"`
	// BlockMessage replaces the default message returned when the policy blocks.
	BlockMessage string   `gorm:"type:text" json:"blockMessage,omitempty"`
	GuardrailIDs []string `gorm:"serializer:json" json:"guardrailIDs"`
	// Subjects limit a compiled MCP guardrail filter to users and groups.
	Subjects []GuardrailPolicySubject `gorm:"-" json:"-"`
}

// GuardrailPolicySubject limits an MCP guardrail filter to a user, a group or everyone.
type GuardrailPolicySubject struct {
	Type string `json:"type"`
	ID   string `json:"id,omitempty"`
}

// Guardrail configures one checker. Sensitive settings are kept in the encrypted
// credential store, not here.
type Guardrail struct {
	ID          string          `gorm:"primaryKey;type:text" json:"id"`
	CreatedAt   time.Time       `json:"created"`
	UpdatedAt   time.Time       `json:"updated"`
	Name        string          `gorm:"type:text;not null" json:"name"`
	Description string          `gorm:"type:text" json:"description,omitempty"`
	Type        string          `gorm:"type:text;not null" json:"type"`
	Config      json.RawMessage `json:"config,omitempty"`
}
