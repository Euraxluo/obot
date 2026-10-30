package handlers

import "testing"

func TestMarketOpenDefaultsFalse(t *testing.T) {
	if marketOpenEnabled() {
		t.Fatal("marketOpenEnabled() = true, want false by default")
	}

	t.Setenv("OBOT_MARKET_OPEN", "true")
	if !marketOpenEnabled() {
		t.Fatal("marketOpenEnabled() = false, want true when enabled")
	}
}
