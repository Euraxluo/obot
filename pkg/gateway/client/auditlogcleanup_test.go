package client

import (
	"context"
	"testing"
	"time"

	gatewaydb "github.com/obot-platform/obot/pkg/gateway/db"
	"github.com/obot-platform/obot/pkg/gateway/types"
	sservices "github.com/obot-platform/obot/pkg/storage/services"
)

func newTestClient(t *testing.T) *Client {
	t.Helper()

	services, err := sservices.New(sservices.Config{DSN: "sqlite://:memory:"})
	if err != nil {
		t.Fatalf("failed to create storage services: %v", err)
	}
	db, err := gatewaydb.New(services.DB.DB, services.DB.SQLDB, true)
	if err != nil {
		t.Fatalf("failed to create gateway db: %v", err)
	}
	if err := db.AutoMigrate(); err != nil {
		t.Fatalf("failed to auto-migrate: %v", err)
	}
	return &Client{
		db:                        db,
		auditLogCleanupInterval:   20 * time.Millisecond,
		auditLogDeleteBatchSize:   3,
		deviceScanCleanupInterval: 20 * time.Millisecond,
		deviceScanDeleteBatchSize: 3,
	}
}

func insertAuditLog(t *testing.T, c *Client, createdAt time.Time) {
	t.Helper()
	if err := c.db.WithContext(t.Context()).Create(&types.MCPAuditLog{CreatedAt: createdAt}).Error; err != nil {
		t.Fatalf("failed to insert audit log: %v", err)
	}
}

func countAuditLogs(t *testing.T, c *Client) int64 {
	t.Helper()
	var count int64
	if err := c.db.WithContext(t.Context()).Model(&types.MCPAuditLog{}).Count(&count).Error; err != nil {
		t.Fatalf("failed to count audit logs: %v", err)
	}
	return count
}

func insertAPIKey(t *testing.T, c *Client, revokedAt *time.Time) {
	t.Helper()
	key := types.APIKey{
		UserID:    1,
		Name:      "retention-test",
		CreatedAt: time.Now().UTC().AddDate(0, 0, -200),
		RevokedAt: revokedAt,
	}
	if err := c.db.WithContext(t.Context()).Create(&key).Error; err != nil {
		t.Fatalf("failed to insert API key: %v", err)
	}
}

func countAPIKeys(t *testing.T, c *Client) int64 {
	t.Helper()
	var count int64
	if err := c.db.WithContext(t.Context()).Model(&types.APIKey{}).Count(&count).Error; err != nil {
		t.Fatalf("failed to count API keys: %v", err)
	}
	return count
}

func TestRetentionCleanup(t *testing.T) {
	c := newTestClient(t)
	now := time.Now().UTC()
	oldRevocation := now.AddDate(0, 0, -100)
	insertAuditLog(t, c, now.AddDate(0, 0, -100))
	insertAuditLog(t, c, now.AddDate(0, 0, -1))
	insertAPIKey(t, c, &oldRevocation)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go c.runRetentionCleanup(ctx, 90)

	deadline := time.Now().Add(2 * time.Second)
	for {
		if countAuditLogs(t, c) == 1 && countAPIKeys(t, c) == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for retention cleanup: logs=%d keys=%d", countAuditLogs(t, c), countAPIKeys(t, c))
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRetentionCleanupDisabled(t *testing.T) {
	c := newTestClient(t)
	now := time.Now().UTC()
	insertAuditLog(t, c, now.AddDate(0, 0, -100))
	insertAuditLog(t, c, now)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go c.runRetentionCleanup(ctx, 0)
	time.Sleep(50 * time.Millisecond)

	if got := countAuditLogs(t, c); got != 2 {
		t.Fatalf("audit logs after disabled cleanup = %d, want 2", got)
	}
}
