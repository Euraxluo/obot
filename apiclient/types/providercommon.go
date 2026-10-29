package types

type CommonProviderMetadata struct {
	Name                            string                           `json:"name"`
	Command                         string                           `json:"command,omitempty"`
	Args                            []string                         `json:"args,omitempty" yaml:"args,omitempty"`
	Icon                            string                           `json:"icon,omitempty"`
	IconDark                        string                           `json:"iconDark,omitempty"`
	Description                     string                           `json:"description,omitempty"`
	Link                            string                           `json:"link,omitempty"`
	RequiredConfigurationParameters []ProviderConfigurationParameter `json:"requiredConfigurationParameters,omitempty" yaml:"requiredConfigurationParameters,omitempty"`
	OptionalConfigurationParameters []ProviderConfigurationParameter `json:"optionalConfigurationParameters,omitempty" yaml:"optionalConfigurationParameters,omitempty"`
}

type CommonProviderStatus struct {
	Configured                     bool     `json:"configured"`
	MissingConfigurationParameters []string `json:"missingConfigurationParameters,omitempty"`
}

type ProviderConfigurationParameter struct {
	Name         string `json:"name"`
	FriendlyName string `json:"friendlyName,omitempty" yaml:"friendlyName,omitempty"`
	Description  string `json:"description,omitempty"`
	Sensitive    bool   `json:"sensitive,omitempty"`
	Hidden       bool   `json:"hidden,omitempty"`
	Multiline    bool   `json:"multiline,omitempty"`
}
