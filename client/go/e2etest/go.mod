// This is a separate module so that tunnel-server (and its large dependency
// tree) stays out of the client application's go.mod/go.sum. It contains
// integration tests only; nothing here ships in the app.
module localhost/client/go/e2etest

go 1.25.0

require (
	github.com/stretchr/testify v1.10.0
	golang.getoutline.org/sdk v0.1.0-rc1
	golang.getoutline.org/tunnel-server v1.9.3-rc2
	localhost v0.0.0
)

require (
	github.com/Wifx/gonetworkmanager/v2 v2.1.0 // indirect
	github.com/bool64/ctxd v1.2.1 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/eycorsican/go-tun2socks v1.16.11 // indirect
	github.com/goccy/go-yaml v1.18.0 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/shadowsocks/go-shadowsocks2 v0.1.5 // indirect
	github.com/songgao/water v0.0.0-20200317203138-2b4b6d7c09d8 // indirect
	github.com/spf13/afero v1.14.0 // indirect
	go.nhat.io/cookiejar v0.3.0 // indirect
	golang.getoutline.org/sdk/x v0.0.9-alpha.1 // indirect
	golang.org/x/crypto v0.42.0 // indirect
	golang.org/x/sys v0.36.0 // indirect
	golang.org/x/text v0.29.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace localhost => ../../..
