package types

import (
	"time"

	types2 "github.com/obot-platform/obot/apiclient/types"
)

type APIActivity struct {
	ID     uint
	UserID string    `gorm:"index:idx_api_activity_date_user,priority:2"`
	Date   time.Time `gorm:"index:idx_api_activity_date_user,priority:1"`
}

func ConvertAPIActivity(a APIActivity) types2.APIActivity {
	return types2.APIActivity{
		UserID: a.UserID,
		Date:   *types2.NewTime(a.Date),
	}
}
