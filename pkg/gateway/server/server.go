package server

import (
	"github.com/obot-platform/obot/pkg/accesscontrolrule"
	"github.com/obot-platform/obot/pkg/gateway/db"
	"github.com/obot-platform/obot/pkg/gateway/server/dispatcher"
	"github.com/obot-platform/obot/pkg/jwt/persistent"
)

type Options struct {
	Hostname   string
	UIHostname string `name:"ui-hostname" env:"OBOT_SERVER_UI_HOSTNAME"`
}

type Server struct {
	db             *db.DB
	baseURL, uiURL string
	tokenService   *persistent.TokenService
	dispatcher     *dispatcher.Dispatcher
	acrHelper      *accesscontrolrule.Helper
}

func New(db *db.DB, tokenService *persistent.TokenService, modelProviderDispatcher *dispatcher.Dispatcher, acrHelper *accesscontrolrule.Helper, opts Options) (*Server, error) {
	s := &Server{
		db:           db,
		baseURL:      opts.Hostname,
		uiURL:        opts.UIHostname,
		tokenService: tokenService,
		dispatcher:   modelProviderDispatcher,
		acrHelper:    acrHelper,
	}

	return s, nil
}
